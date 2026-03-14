import * as RadixPopover from "@radix-ui/react-popover";
import type { KeyboardEvent, ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { useDebouncedEffect } from "@/utils/react-use";

const FILE_MENTION_LIMIT = 8;
const MENTION_QUERY_DEBOUNCE_MS = 120;

interface ActivePromptToken {
	kind: "mention";
	start: number;
	end: number;
	query: string;
}

interface PromptSuggestion {
	id: string;
	kind: "mention";
	text: string;
	insertText: string;
}

interface TaskPromptComposerProps {
	id?: string;
	value: string;
	onValueChange: (value: string) => void;
	onSubmit?: () => void;
	onSubmitAndStart?: () => void;
	placeholder?: string;
	disabled?: boolean;
	enabled?: boolean;
	autoFocus?: boolean;
	workspaceId?: string | null;
}

function detectActivePromptToken(value: string, cursorIndex: number): ActivePromptToken | null {
	const head = value.slice(0, cursorIndex);
	let tokenStart = head.length;
	while (tokenStart > 0) {
		const previous = head[tokenStart - 1];
		if (previous && /\s/.test(previous)) {
			break;
		}
		tokenStart -= 1;
	}
	const token = head.slice(tokenStart);
	if (!token.startsWith("@")) {
		return null;
	}
	return {
		kind: "mention",
		start: tokenStart,
		end: cursorIndex,
		query: token.slice(1),
	};
}

function applyTokenReplacement(
	value: string,
	token: ActivePromptToken,
	replacement: string,
): { value: string; cursor: number } {
	const before = value.slice(0, token.start);
	const after = value.slice(token.end);
	const shouldAppendSpace = after.length === 0 || !/^\s/.test(after);
	const spacer = shouldAppendSpace ? " " : "";
	const nextValue = `${before}${replacement}${spacer}${after}`;
	const nextCursor = before.length + replacement.length + spacer.length;
	return {
		value: nextValue,
		cursor: nextCursor,
	};
}

export function TaskPromptComposer({
	id,
	value,
	onValueChange,
	onSubmit,
	onSubmitAndStart,
	placeholder,
	disabled,
	enabled = true,
	autoFocus = false,
	workspaceId = null,
}: TaskPromptComposerProps): ReactElement {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const suggestionItemRefs = useRef(new Map<string, HTMLButtonElement>());
	const mentionSearchRequestIdRef = useRef(0);
	const [cursorIndex, setCursorIndex] = useState(0);
	const [mentionSuggestions, setMentionSuggestions] = useState<PromptSuggestion[]>([]);
	const [isMentionSearchLoading, setIsMentionSearchLoading] = useState(false);
	const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
	const [isSuggestionPickerOpen, setIsSuggestionPickerOpen] = useState(true);

	const activeToken = useMemo(() => detectActivePromptToken(value, cursorIndex), [cursorIndex, value]);

	useEffect(() => {
		if (!enabled) {
			mentionSearchRequestIdRef.current += 1;
			setMentionSuggestions([]);
			setIsMentionSearchLoading(false);
			return;
		}
		if (!activeToken || activeToken.kind !== "mention") {
			mentionSearchRequestIdRef.current += 1;
			setMentionSuggestions([]);
			setIsMentionSearchLoading(false);
			return;
		}
		mentionSearchRequestIdRef.current += 1;
	}, [activeToken, workspaceId]);

	useDebouncedEffect(
		() => {
			if (!enabled) {
				return;
			}
			if (!activeToken || activeToken.kind !== "mention") {
				return;
			}
			const requestId = mentionSearchRequestIdRef.current;
			setIsMentionSearchLoading(true);
			void (async () => {
				try {
					if (!workspaceId) {
						throw new Error("No workspace selected.");
					}
					const trpcClient = getRuntimeTrpcClient(workspaceId);
					const payload = await trpcClient.workspace.searchFiles.query({
						query: activeToken.query,
						limit: FILE_MENTION_LIMIT,
					});
					if (requestId !== mentionSearchRequestIdRef.current) {
						return;
					}
					setMentionSuggestions(
						Array.isArray(payload.files)
							? payload.files.map((file) => ({
									id: file.path,
									kind: "mention",
									text: file.path,
									insertText: `@${file.path}`,
								}))
							: [],
					);
				} catch {
					if (requestId === mentionSearchRequestIdRef.current) {
						setMentionSuggestions([]);
					}
				} finally {
					if (requestId === mentionSearchRequestIdRef.current) {
						setIsMentionSearchLoading(false);
					}
				}
			})();
		},
		MENTION_QUERY_DEBOUNCE_MS,
		[activeToken, enabled, workspaceId],
	);

	const suggestions = useMemo(() => {
		return enabled && activeToken ? mentionSuggestions : ([] as PromptSuggestion[]);
	}, [activeToken, enabled, mentionSuggestions]);

	useEffect(() => {
		setSelectedSuggestionIndex(0);
		setIsSuggestionPickerOpen(true);
	}, [activeToken?.kind, activeToken?.query, activeToken?.start]);

	useEffect(() => {
		if (!autoFocus || disabled || !enabled) {
			return;
		}
		window.requestAnimationFrame(() => {
			if (!textareaRef.current) {
				return;
			}
			const cursor = textareaRef.current.value.length;
			textareaRef.current.focus();
			textareaRef.current.setSelectionRange(cursor, cursor);
			setCursorIndex(cursor);
		});
	}, [autoFocus, disabled, enabled]);

	const applySuggestion = useCallback(
		(suggestion: PromptSuggestion) => {
			if (!activeToken) {
				return;
			}
			const next = applyTokenReplacement(value, activeToken, suggestion.insertText);
			onValueChange(next.value);
			window.requestAnimationFrame(() => {
				if (!textareaRef.current) {
					return;
				}
				textareaRef.current.focus();
				textareaRef.current.setSelectionRange(next.cursor, next.cursor);
				setCursorIndex(next.cursor);
			});
		},
		[activeToken, onValueChange, value],
	);

	const setSuggestionItemRef = useCallback((itemKey: string, node: HTMLButtonElement | null) => {
		if (node) {
			suggestionItemRefs.current.set(itemKey, node);
			return;
		}
		suggestionItemRefs.current.delete(itemKey);
	}, []);

	const handleTextareaKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				if (event.shiftKey) {
					if (onSubmitAndStart) {
						onSubmitAndStart();
						return;
					}
				}
				onSubmit?.();
				return;
			}

			const canShowSuggestions = isSuggestionPickerOpen && suggestions.length > 0;
			if (canShowSuggestions && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
				event.preventDefault();
				const direction = event.key === "ArrowDown" ? 1 : -1;
				setSelectedSuggestionIndex((index) => {
					const nextIndex = index + direction;
					if (nextIndex < 0) {
						return suggestions.length - 1;
					}
					if (nextIndex >= suggestions.length) {
						return 0;
					}
					return nextIndex;
				});
				return;
			}

			if (canShowSuggestions && (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey))) {
				event.preventDefault();
				const selectedSuggestion = suggestions[selectedSuggestionIndex] ?? suggestions[0];
				if (selectedSuggestion) {
					applySuggestion(selectedSuggestion);
				}
				return;
			}

			if (event.key === "Escape" && canShowSuggestions) {
				event.preventDefault();
				setIsSuggestionPickerOpen(false);
			}
		},
		[applySuggestion, isSuggestionPickerOpen, onSubmit, onSubmitAndStart, selectedSuggestionIndex, suggestions],
	);

	const showMentionLoading = Boolean(enabled && activeToken && isMentionSearchLoading);
	const showSuggestions = Boolean(
		enabled && isSuggestionPickerOpen && activeToken && (showMentionLoading || suggestions.length > 0),
	);

	useEffect(() => {
		if (!showSuggestions) {
			return;
		}
		const activeSuggestion = suggestions[selectedSuggestionIndex];
		if (!activeSuggestion) {
			return;
		}
		const activeKey = `${activeSuggestion.kind}:${activeSuggestion.id}`;
		const activeElement = suggestionItemRefs.current.get(activeKey);
		const menuElement = menuRef.current;
		if (!activeElement || !menuElement) {
			return;
		}
		const activeTop = activeElement.offsetTop;
		const activeBottom = activeTop + activeElement.offsetHeight;
		const viewportTop = menuElement.scrollTop;
		const viewportBottom = viewportTop + menuElement.clientHeight;
		if (activeBottom > viewportBottom) {
			menuElement.scrollTop = activeBottom - menuElement.clientHeight;
			return;
		}
		if (activeTop < viewportTop) {
			menuElement.scrollTop = activeTop;
		}
	}, [selectedSuggestionIndex, showSuggestions, suggestions]);

	return (
		<RadixPopover.Root open={showSuggestions}>
			<RadixPopover.Anchor asChild>
				<textarea
					id={id}
					ref={textareaRef}
					value={value}
					onChange={(event) => {
						onValueChange(event.target.value);
						setCursorIndex(event.target.selectionStart ?? event.target.value.length);
					}}
					onKeyDown={handleTextareaKeyDown}
					onClick={(event) => setCursorIndex(event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
					onKeyUp={(event) => setCursorIndex(event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
					placeholder={placeholder}
					disabled={disabled}
					className="w-full rounded-md border border-border-bright bg-surface-3 p-3 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
					style={{ minHeight: 80, resize: "vertical" }}
				/>
			</RadixPopover.Anchor>
			<RadixPopover.Portal>
				<RadixPopover.Content
					className="z-50 rounded-lg border border-border bg-surface-1 shadow-xl overflow-hidden"
					style={{ width: "var(--radix-popover-anchor-width)" }}
					sideOffset={4}
					onOpenAutoFocus={(event) => event.preventDefault()}
					onCloseAutoFocus={(event) => event.preventDefault()}
				>
					{showMentionLoading ? (
						<div className="px-2.5 py-1.5 text-[13px] text-text-tertiary">Loading files...</div>
					) : (
						<div ref={menuRef} className="max-h-[200px] overflow-x-hidden overflow-y-auto p-1">
							{suggestions.map((suggestion, index) => {
								const suggestionKey = `${suggestion.kind}:${suggestion.id}`;
								return (
									<button
										type="button"
										key={suggestionKey}
										ref={(node) => setSuggestionItemRef(suggestionKey, node)}
										className={`flex w-full items-center px-1.5 py-1 text-left rounded-md ${index === selectedSuggestionIndex ? "bg-surface-3" : "hover:bg-surface-3"}`}
										onMouseDown={(event) => {
											event.preventDefault();
											applySuggestion(suggestion);
										}}
										onMouseEnter={() => setSelectedSuggestionIndex(index)}
									>
										<span
											className="block text-xs leading-tight max-w-full text-text-primary"
											style={{
												overflowWrap: "anywhere",
												wordBreak: "break-word",
												whiteSpace: "normal",
											}}
										>
											{suggestion.text}
										</span>
									</button>
								);
							})}
						</div>
					)}
				</RadixPopover.Content>
			</RadixPopover.Portal>
		</RadixPopover.Root>
	);
}
