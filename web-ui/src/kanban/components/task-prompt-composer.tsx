import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";

import { Textarea } from "@/components/ui/textarea";
import type {
	RuntimeSlashCommandDescription,
	RuntimeSlashCommandsResponse,
	RuntimeWorkspaceFileSearchResponse,
} from "@/kanban/runtime/types";

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
	label: string;
	detail: string;
	badge?: string;
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

function applyTokenReplacement(value: string, token: ActivePromptToken, replacement: string): { value: string; cursor: number } {
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

function sortSlashSuggestions(
	query: string,
	commands: RuntimeSlashCommandDescription[],
): PromptSuggestion[] {
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
		label: entry.name.startsWith("/") ? entry.name : `/${entry.name}`,
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
	disallowedSlashCommands = [],
}: TaskPromptComposerProps): ReactElement {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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
				const response = await fetch("/api/runtime/slash-commands");
				if (!response.ok) {
					throw new Error(`Slash command request failed with ${response.status}`);
				}
				const payload = (await response.json()) as RuntimeSlashCommandsResponse;
				if (cancelled) {
					return;
				}
				const resolvedCommands = Array.isArray(payload.commands) && payload.commands.length > 0
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
	}, [disallowedSlashCommandSet, enabled]);

	useEffect(() => {
		if (!activeToken || activeToken.kind !== "mention") {
			setMentionSuggestions([]);
			setIsMentionSearchLoading(false);
			return;
		}

		let cancelled = false;
		const timeoutId = window.setTimeout(async () => {
			setIsMentionSearchLoading(true);
			try {
				const params = new URLSearchParams({
					q: activeToken.query,
					limit: String(FILE_MENTION_LIMIT),
				});
				const response = await fetch(`/api/workspace/files/search?${params.toString()}`);
				if (!response.ok) {
					throw new Error(`Workspace file search failed with ${response.status}`);
				}
				const payload = (await response.json()) as RuntimeWorkspaceFileSearchResponse;
				if (cancelled) {
					return;
				}
				setMentionSuggestions(
					Array.isArray(payload.files)
						? payload.files.map((file) => ({
								id: file.path,
								label: `@${file.name}`,
								detail: file.path,
								badge: file.changed ? "changed" : undefined,
								insertText: `@${file.path}`,
							}))
						: [],
				);
			} catch {
				if (!cancelled) {
					setMentionSuggestions([]);
				}
			} finally {
				if (!cancelled) {
					setIsMentionSearchLoading(false);
				}
			}
		}, MENTION_QUERY_DEBOUNCE_MS);

		return () => {
			cancelled = true;
			window.clearTimeout(timeoutId);
		};
	}, [activeToken]);

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

	const handleTextareaKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
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
				return;
			}

			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				onSubmit?.();
			}
		},
		[applySuggestion, isSuggestionPickerOpen, onSubmit, selectedSuggestionIndex, suggestions],
	);

	const showMentionLoading = Boolean(activeToken && activeToken.kind === "mention" && isMentionSearchLoading);
	const showSlashLoading = Boolean(activeToken && activeToken.kind === "slash" && isSlashCommandsLoading);
	const showSuggestions = isSuggestionPickerOpen && activeToken && (showMentionLoading || showSlashLoading || suggestions.length > 0);

	return (
		<div className="relative">
			<Textarea
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
				onSelect={(event) => setCursorIndex(event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
				placeholder={placeholder}
				disabled={disabled}
				className="min-h-20 resize-y bg-background text-sm"
			/>
			{showSuggestions ? (
				<div className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-md border border-border bg-card shadow-lg">
					<div className="max-h-48 overflow-y-auto p-1">
						{showMentionLoading ? (
							<p className="px-2 py-1 text-xs text-muted-foreground">Loading files...</p>
						) : showSlashLoading ? (
							<p className="px-2 py-1 text-xs text-muted-foreground">Loading commands...</p>
						) : (
							suggestions.map((suggestion, index) => (
								<button
									key={suggestion.id}
									type="button"
									onMouseDown={(event) => {
										event.preventDefault();
										applySuggestion(suggestion);
									}}
									onMouseEnter={() => setSelectedSuggestionIndex(index)}
									className={`flex w-full cursor-pointer items-start justify-between gap-2 rounded px-2 py-1.5 text-left text-xs ${
										index === selectedSuggestionIndex ? "bg-accent text-accent-foreground" : "text-foreground"
									}`}
								>
									<div className="min-w-0">
										<div className="flex items-center gap-2">
											<span className="truncate font-mono">{suggestion.label}</span>
											{suggestion.badge ? (
												<span className="rounded bg-accent px-1.5 py-0.5 text-[9px] uppercase tracking-wide">
													{suggestion.badge}
												</span>
											) : null}
										</div>
										<span className="block truncate text-[10px] text-muted-foreground">{suggestion.detail}</span>
									</div>
								</button>
							))
						)}
					</div>
					{activeToken?.kind === "slash" && slashCommandError ? (
						<p className="border-t border-border px-2 py-1 text-[10px] text-muted-foreground">
							Using fallback commands while discovery is unavailable.
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
