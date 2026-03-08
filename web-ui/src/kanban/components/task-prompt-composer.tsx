import { Classes, Menu, MenuItem, Popover, PopoverInteractionKind, TextArea } from "@blueprintjs/core";
import { Classes as SelectClasses } from "@blueprintjs/select";
import type { KeyboardEvent, ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDebouncedEffect } from "@/kanban/utils/react-use";
import { getRuntimeTrpcClient } from "@/kanban/runtime/trpc-client";
import type { RuntimeSlashCommandDescription } from "@/kanban/runtime/types";

const FILE_MENTION_LIMIT = 8;
const MENTION_QUERY_DEBOUNCE_MS = 120;

const DEFAULT_SLASH_COMMANDS: RuntimeSlashCommandDescription[] = [];

interface ActivePromptToken {
	kind: "slash" | "mention";
	start: number;
	end: number;
	query: string;
}

interface PromptSuggestion {
	id: string;
	kind: "slash" | "mention";
	text: string;
	detail?: string;
	insertText: string;
}

interface TaskPromptComposerProps {
	id?: string;
	value: string;
	onValueChange: (value: string) => void;
	onSubmit?: () => void;
	placeholder?: string;
	disabled?: boolean;
	enabled?: boolean;
	autoFocus?: boolean;
	workspaceId?: string | null;
	disallowedSlashCommands?: string[];
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
	if (!token.startsWith("@") && !token.startsWith("/")) {
		return null;
	}
	const tokenEnd = cursorIndex;
	if (token.startsWith("@")) {
		return {
			kind: "mention",
			start: tokenStart,
			end: tokenEnd,
			query: token.slice(1),
		};
	}
	if (token.startsWith("/")) {
		return {
			kind: "slash",
			start: tokenStart,
			end: tokenEnd,
			query: token.slice(1),
		};
	}
	return null;
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

function sortSlashSuggestions(query: string, commands: RuntimeSlashCommandDescription[]): PromptSuggestion[] {
	const normalizedQuery = query.trim().toLowerCase();
	const filtered = commands.filter((entry) => {
		const normalizedName = entry.name.startsWith("/") ? entry.name.slice(1) : entry.name;
		if (!normalizedQuery) {
			return true;
		}
		return normalizedName.includes(normalizedQuery) || normalizedName.startsWith(normalizedQuery);
	});
	return filtered.map((entry) => ({
		id: entry.name,
		kind: "slash",
		text: entry.name.startsWith("/") ? entry.name : `/${entry.name}`,
		detail: entry.description ?? "Agent command",
		insertText: entry.name.startsWith("/") ? entry.name : `/${entry.name}`,
	}));
}

export function TaskPromptComposer({
	id,
	value,
	onValueChange,
	onSubmit,
	placeholder,
	disabled,
	enabled = true,
	autoFocus = false,
	workspaceId = null,
	disallowedSlashCommands = [],
}: TaskPromptComposerProps): ReactElement {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const popoverRef = useRef<InstanceType<typeof Popover> | null>(null);
	const menuRef = useRef<HTMLUListElement | null>(null);
	const suggestionItemRefs = useRef(new Map<string, HTMLLIElement>());
	const mentionSearchRequestIdRef = useRef(0);
	const [cursorIndex, setCursorIndex] = useState(0);
	const [mentionSuggestions, setMentionSuggestions] = useState<PromptSuggestion[]>([]);
	const [isMentionSearchLoading, setIsMentionSearchLoading] = useState(false);
	const [slashCommands, setSlashCommands] = useState<RuntimeSlashCommandDescription[]>(DEFAULT_SLASH_COMMANDS);
	const [isSlashCommandsLoading, setIsSlashCommandsLoading] = useState(false);
	const [slashCommandError, setSlashCommandError] = useState<string | null>(null);
	const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
	const [isSuggestionPickerOpen, setIsSuggestionPickerOpen] = useState(true);

	const activeToken = useMemo(() => detectActivePromptToken(value, cursorIndex), [cursorIndex, value]);
	const disallowedSlashCommandSet = useMemo(
		() =>
			new Set(
				disallowedSlashCommands
					.map((command) => command.trim().toLowerCase())
					.filter((command) => command.length > 0),
			),
		[disallowedSlashCommands],
	);

	useEffect(() => {
		if (!enabled) {
			return;
		}
		let cancelled = false;
		setIsSlashCommandsLoading(true);
		void (async () => {
			try {
				if (!workspaceId) {
					throw new Error("No workspace selected.");
				}
				const trpcClient = getRuntimeTrpcClient(workspaceId);
				const payload = await trpcClient.runtime.getSlashCommands.query(null);
				if (cancelled) {
					return;
				}
				const resolvedCommands =
					Array.isArray(payload.commands) && payload.commands.length > 0
						? payload.commands
						: DEFAULT_SLASH_COMMANDS;
				const allowedCommands = resolvedCommands.filter((command) => {
					const normalizedName = command.name.replace(/^\//, "").trim().toLowerCase();
					return normalizedName && !disallowedSlashCommandSet.has(normalizedName);
				});
				setSlashCommands(allowedCommands);
				setSlashCommandError(payload.error);
			} catch (error) {
				if (cancelled) {
					return;
				}
				setSlashCommands(
					DEFAULT_SLASH_COMMANDS.filter((command) => {
						const normalizedName = command.name.replace(/^\//, "").trim().toLowerCase();
						return normalizedName && !disallowedSlashCommandSet.has(normalizedName);
					}),
				);
				setSlashCommandError(error instanceof Error ? error.message : String(error));
			} finally {
				if (!cancelled) {
					setIsSlashCommandsLoading(false);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [disallowedSlashCommandSet, enabled, workspaceId]);

	useEffect(() => {
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
		[activeToken, workspaceId],
	);

	const slashSuggestions = useMemo<PromptSuggestion[]>(() => {
		if (!activeToken || activeToken.kind !== "slash") {
			return [];
		}
		return sortSlashSuggestions(activeToken.query, slashCommands);
	}, [activeToken, slashCommands]);

	const suggestions = useMemo(() => {
		if (!activeToken) {
			return [] as PromptSuggestion[];
		}
		if (activeToken.kind === "slash") {
			return slashSuggestions;
		}
		return mentionSuggestions;
	}, [activeToken, mentionSuggestions, slashSuggestions]);

	useEffect(() => {
		setSelectedSuggestionIndex(0);
		setIsSuggestionPickerOpen(true);
	}, [activeToken?.kind, activeToken?.query, activeToken?.start]);

	useEffect(() => {
		if (!autoFocus) {
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
	}, [autoFocus]);

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

	const setSuggestionItemRef = useCallback((itemKey: string, node: HTMLLIElement | null) => {
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
		[applySuggestion, isSuggestionPickerOpen, onSubmit, selectedSuggestionIndex, suggestions],
	);

	const showMentionLoading = Boolean(activeToken && activeToken.kind === "mention" && isMentionSearchLoading);
	const showSlashLoading = Boolean(activeToken && activeToken.kind === "slash" && isSlashCommandsLoading);
	const showSuggestions = Boolean(
		isSuggestionPickerOpen && activeToken && (showMentionLoading || showSlashLoading || suggestions.length > 0),
	);

	useEffect(() => {
		if (!showSuggestions) {
			return;
		}
		window.requestAnimationFrame(() => {
			void popoverRef.current?.reposition();
		});
	}, [activeToken?.query, showMentionLoading, showSlashLoading, showSuggestions, suggestions.length]);

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
		<Popover
			autoFocus={false}
			enforceFocus={false}
			fill
			interactionKind={PopoverInteractionKind.CLICK_TARGET_ONLY}
			isOpen={showSuggestions}
			matchTargetWidth
			minimal
			modifiers={{ flip: { enabled: false } }}
			onInteraction={(nextOpenState) => {
				if (!nextOpenState) {
					setIsSuggestionPickerOpen(false);
				}
			}}
			onOpened={() => {
				void popoverRef.current?.reposition();
			}}
			placement="bottom-start"
			popoverClassName={SelectClasses.SUGGEST_POPOVER}
			content={
				showMentionLoading ? (
					<Menu>
						<MenuItem disabled text="Loading files..." roleStructure="listoption" />
					</Menu>
				) : showSlashLoading ? (
					<Menu>
						<MenuItem disabled text="Loading commands..." roleStructure="listoption" />
					</Menu>
				) : (
					<Menu ulRef={menuRef} style={{ overflowX: "hidden", overflowY: "auto" }}>
						{suggestions.map((suggestion, index) => {
							const suggestionKey = `${suggestion.kind}:${suggestion.id}`;
							return (
								<MenuItem
									key={suggestionKey}
									ref={(node) => setSuggestionItemRef(suggestionKey, node)}
									active={index === selectedSuggestionIndex}
									roleStructure="listoption"
									style={
										suggestion.kind === "mention"
											? {
													paddingLeft: 6,
													paddingRight: 6,
												}
											: undefined
									}
									text={
										suggestion.kind === "mention" ? (
											<span
												style={{
													display: "block",
													fontSize: "var(--bp-typography-size-body-small)",
													lineHeight: 1.15,
													maxWidth: "100%",
													overflowWrap: "anywhere",
													wordBreak: "break-word",
													whiteSpace: "normal",
												}}
											>
												{suggestion.text}
											</span>
										) : (
											<div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
												<span className={Classes.TEXT_OVERFLOW_ELLIPSIS}>{suggestion.text}</span>
												{suggestion.detail ? (
													<span
														className={`${Classes.TEXT_MUTED} ${Classes.TEXT_OVERFLOW_ELLIPSIS}`}
														style={{ fontSize: "var(--bp-typography-size-body-small)" }}
													>
														{suggestion.detail}
													</span>
												) : null}
											</div>
										)
									}
									onMouseDown={(event) => {
										event.preventDefault();
										applySuggestion(suggestion);
									}}
									onMouseEnter={() => setSelectedSuggestionIndex(index)}
								/>
							);
						})}
						{activeToken?.kind === "slash" && slashCommandError ? (
							<MenuItem
								disabled
								roleStructure="listoption"
								text="Using fallback commands while discovery is unavailable."
							/>
						) : null}
					</Menu>
				)
			}
			ref={popoverRef}
		>
			<TextArea
				id={id}
				inputRef={textareaRef}
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
				autoFocus={autoFocus}
				fill
				style={{ minHeight: 80, resize: "vertical" }}
			/>
		</Popover>
	);
}
