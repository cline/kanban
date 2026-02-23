import { Card, Classes, Menu, MenuItem, Tag, TextArea } from "@blueprintjs/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";

import type {
	RuntimeSlashCommandDescription,
	RuntimeSlashCommandsResponse,
	RuntimeWorkspaceFileSearchResponse,
} from "@/kanban/runtime/types";
import { workspaceFetch } from "@/kanban/runtime/workspace-fetch";

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
	workspaceId = null,
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
				const response = await workspaceFetch("/api/runtime/slash-commands", {
					workspaceId,
				});
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
	}, [disallowedSlashCommandSet, enabled, workspaceId]);

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
				const response = await workspaceFetch(`/api/workspace/files/search?${params.toString()}`, {
					workspaceId,
				});
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
	}, [activeToken, workspaceId]);

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
		<div style={{ position: "relative" }}>
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
				fill
				style={{ minHeight: 80, resize: "vertical" }}
			/>
			{showSuggestions ? (
				<Card style={{ position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 4, maxHeight: 256, overflowY: "auto", zIndex: 10 }} compact elevation={2}>
					{showMentionLoading ? (
						<p className={`${Classes.TEXT_MUTED} kb-suggestions-loading`}>Loading files...</p>
					) : showSlashLoading ? (
						<p className={`${Classes.TEXT_MUTED} kb-suggestions-loading`}>Loading commands...</p>
					) : (
						<Menu>
							{suggestions.map((suggestion, index) => (
								<MenuItem
									key={suggestion.id}
									active={index === selectedSuggestionIndex}
									text={suggestion.label}
									label={suggestion.detail}
									className={Classes.MONOSPACE_TEXT}
									labelElement={
										suggestion.badge ? (
											<Tag minimal>
												{suggestion.badge}
											</Tag>
										) : undefined
									}
									onMouseDown={(event: React.MouseEvent) => {
										event.preventDefault();
										applySuggestion(suggestion);
									}}
									onMouseEnter={() => setSelectedSuggestionIndex(index)}
								/>
							))}
						</Menu>
					)}
					{activeToken?.kind === "slash" && slashCommandError ? (
						<p className={`${Classes.TEXT_MUTED} kb-suggestions-loading`}>
							Using fallback commands while discovery is unavailable.
						</p>
					) : null}
				</Card>
			) : null}
		</div>
	);
}
