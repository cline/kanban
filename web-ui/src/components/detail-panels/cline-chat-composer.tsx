import { AlertTriangle, ArrowBigUp, Command, Pause, SendHorizontal } from "lucide-react";
import {
	type ClipboardEvent,
	type DragEvent,
	type KeyboardEvent,
	type ReactElement,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import {
	type ActiveClineComposerToken,
	applyClineComposerCompletion,
	buildMentionInsertText,
	buildSlashCommandInsertText,
	type ClineComposerCompletionSuggestion,
	detectActiveClineComposerToken,
} from "@/components/detail-panels/cline-chat-composer-completion";
import { ClineChatModelSelector } from "@/components/detail-panels/cline-chat-model-selector";
import { type InlineCompletionItem, InlineCompletionPicker } from "@/components/inline-completion-picker";
import type { SearchSelectOption } from "@/components/search-select-dropdown";
import { collectImageFilesFromDataTransfer, extractImagesFromDataTransfer } from "@/components/task-image-input-utils";
import { TaskImageStrip } from "@/components/task-image-strip";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeClineReasoningEffort, RuntimeSlashCommand, RuntimeTaskSessionMode } from "@/runtime/types";
import type { TaskImage } from "@/types";
import { isMacPlatform } from "@/utils/platform";
import { useDebouncedEffect } from "@/utils/react-use";

const CLINE_CHAT_COMPOSER_MAX_HEIGHT = 160;
const CLINE_CHAT_COMPOSER_COMPLETION_DEBOUNCE_MS = 120;
const CLINE_CHAT_COMPOSER_FILE_LIMIT = 8;
const CLINE_CHAT_COMPOSER_COMMAND_LIMIT = 8;

export function ClineChatComposer({
	taskId,
	draft,
	onDraftChange,
	images = [],
	onImagesChange,
	placeholder,
	mode,
	onModeChange,
	showModeToggle = true,
	canSend,
	canCancel,
	onSend,
	onCancel,
	modelOptions,
	recommendedModelIds = [],
	pinSelectedModelToTop = true,
	selectedModelId,
	selectedModelButtonText,
	onSelectModel,
	reasoningEnabledModelIds = [],
	selectedReasoningEffort,
	onSelectReasoningEffort,
	isModelLoading = false,
	isModelSaving = false,
	modelPickerDisabled = false,
	isSending = false,
	warningMessage = null,
	attachmentWarningMessage = null,
	workspaceId = null,
}: {
	taskId: string;
	draft: string;
	onDraftChange: (draft: string) => void;
	images?: TaskImage[];
	onImagesChange?: (images: TaskImage[]) => void;
	placeholder: string;
	mode: RuntimeTaskSessionMode;
	onModeChange: (mode: RuntimeTaskSessionMode) => void;
	showModeToggle?: boolean;
	canSend: boolean;
	canCancel: boolean;
	onSend: () => void | Promise<void>;
	onCancel: () => void;
	modelOptions: readonly SearchSelectOption[];
	recommendedModelIds?: readonly string[];
	pinSelectedModelToTop?: boolean;
	selectedModelId: string;
	selectedModelButtonText: string;
	onSelectModel: (value: string) => void;
	reasoningEnabledModelIds?: readonly string[];
	selectedReasoningEffort: RuntimeClineReasoningEffort | "";
	onSelectReasoningEffort: (value: RuntimeClineReasoningEffort | "") => void;
	isModelLoading?: boolean;
	isModelSaving?: boolean;
	modelPickerDisabled?: boolean;
	isSending?: boolean;
	warningMessage?: string | null;
	attachmentWarningMessage?: string | null;
	workspaceId?: string | null;
}): ReactElement {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const mentionSearchRequestIdRef = useRef(0);
	const slashCommandsRequestIdRef = useRef(0);
	const slashCommandsCacheRef = useRef(new Map<string, RuntimeSlashCommand[]>());
	const [isDragOver, setIsDragOver] = useState(false);
	const [cursorIndex, setCursorIndex] = useState(() => draft.length);
	const [isCompletionPickerOpen, setIsCompletionPickerOpen] = useState(true);
	const [selectedCompletionIndex, setSelectedCompletionIndex] = useState(0);
	const [mentionSuggestions, setMentionSuggestions] = useState<ClineComposerCompletionSuggestion[]>([]);
	const [slashSuggestions, setSlashSuggestions] = useState<ClineComposerCompletionSuggestion[]>([]);
	const [isMentionSearchLoading, setIsMentionSearchLoading] = useState(false);
	const [isSlashSearchLoading, setIsSlashSearchLoading] = useState(false);
	const canSubmit = canSend && !isModelSaving && (draft.trim().length > 0 || images.length > 0);

	const activeToken = useMemo(() => detectActiveClineComposerToken(draft, cursorIndex), [cursorIndex, draft]);
	const completionSuggestions = useMemo(() => {
		if (!activeToken) {
			return [] as ClineComposerCompletionSuggestion[];
		}
		return activeToken.kind === "mention" ? mentionSuggestions : slashSuggestions;
	}, [activeToken, mentionSuggestions, slashSuggestions]);
	const completionItems: InlineCompletionItem[] = useMemo(
		() => completionSuggestions.map((s) => ({ id: s.id, label: s.label, detail: s.detail })),
		[completionSuggestions],
	);
	const isCompletionLoading = activeToken?.kind === "mention" ? isMentionSearchLoading : isSlashSearchLoading;
	const showCompletionPicker = Boolean(activeToken && isCompletionPickerOpen);
	const completionLoadingMessage = activeToken?.kind === "mention" ? "Loading files..." : "Loading commands...";
	const completionEmptyMessage = useMemo(() => {
		if (!activeToken) {
			return null;
		}
		if (activeToken.kind === "mention" && !workspaceId) {
			return "Select a workspace to mention files.";
		}
		if (activeToken.kind === "mention") {
			return "No matching files.";
		}
		return "No matching commands.";
	}, [activeToken, workspaceId]);

	useLayoutEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) {
			return;
		}
		textarea.style.height = "auto";
		textarea.style.height = `${Math.min(textarea.scrollHeight, CLINE_CHAT_COMPOSER_MAX_HEIGHT)}px`;
		textarea.style.overflowY = textarea.scrollHeight > CLINE_CHAT_COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
	}, [draft]);

	useEffect(() => {
		if (!canSend) {
			return;
		}
		// Skip auto-focus on mobile to prevent iOS Safari viewport shift
		if (window.matchMedia("(max-width: 768px)").matches) {
			return;
		}
		textareaRef.current?.focus();
	}, [canSend, taskId]);

	useEffect(() => {
		setCursorIndex((currentValue) => Math.min(currentValue, draft.length));
	}, [draft.length]);

	useEffect(() => {
		setSelectedCompletionIndex(0);
		setIsCompletionPickerOpen(true);
	}, [activeToken?.kind, activeToken?.query, activeToken?.start]);

	useEffect(() => {
		if (!activeToken || activeToken.kind !== "mention") {
			mentionSearchRequestIdRef.current += 1;
			setMentionSuggestions([]);
			setIsMentionSearchLoading(false);
		}
		if (!activeToken || activeToken.kind !== "slash") {
			slashCommandsRequestIdRef.current += 1;
			setSlashSuggestions([]);
			setIsSlashSearchLoading(false);
		}
	}, [activeToken]);

	const appendImages = useCallback(
		(newImages: TaskImage[]) => {
			if (!onImagesChange || newImages.length === 0) {
				return;
			}
			onImagesChange([...images, ...newImages]);
		},
		[images, onImagesChange],
	);

	const handleRemoveImage = useCallback(
		(imageId: string) => {
			onImagesChange?.(images.filter((image) => image.id !== imageId));
		},
		[images, onImagesChange],
	);

	const handlePaste = useCallback(
		(event: ClipboardEvent<HTMLTextAreaElement>) => {
			if (!event.clipboardData) {
				return;
			}
			const imageFiles = collectImageFilesFromDataTransfer(event.clipboardData);
			if (imageFiles.length === 0) {
				return;
			}
			event.preventDefault();
			void (async () => {
				const nextImages = await extractImagesFromDataTransfer(event.clipboardData);
				appendImages(nextImages);
			})();
		},
		[appendImages],
	);

	useDebouncedEffect(
		() => {
			if (!activeToken || activeToken.kind !== "mention" || !workspaceId) {
				return;
			}
			const requestId = ++mentionSearchRequestIdRef.current;
			setIsMentionSearchLoading(true);
			void (async () => {
				try {
					const payload = await getRuntimeTrpcClient(workspaceId).workspace.searchFiles.query({
						query: activeToken.query,
						limit: CLINE_CHAT_COMPOSER_FILE_LIMIT,
					});
					if (requestId !== mentionSearchRequestIdRef.current) {
						return;
					}
					setMentionSuggestions(
						payload.files.map((file) => ({
							id: file.path,
							kind: "mention",
							label: file.name,
							detail: file.path,
							insertText: buildMentionInsertText(file.path),
						})),
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
		CLINE_CHAT_COMPOSER_COMPLETION_DEBOUNCE_MS,
		[activeToken, workspaceId],
	);

	useDebouncedEffect(
		() => {
			if (!activeToken || activeToken.kind !== "slash") {
				return;
			}
			const requestKey = workspaceId ?? "__global__";
			const requestId = ++slashCommandsRequestIdRef.current;
			const cachedCommands = slashCommandsCacheRef.current.get(requestKey);
			const applyCommands = (commands: RuntimeSlashCommand[]) => {
				const query = activeToken.query.trim().toLowerCase();
				const filteredCommands = commands
					.filter((command) => {
						if (query.length === 0) {
							return true;
						}
						const description = command.description?.toLowerCase() ?? "";
						return command.name.toLowerCase().includes(query) || description.includes(query);
					})
					.slice(0, CLINE_CHAT_COMPOSER_COMMAND_LIMIT)
					.map((command) => ({
						id: command.name,
						kind: "slash" as const,
						label: `/${command.name}`,
						detail: command.description,
						insertText: buildSlashCommandInsertText(command.name),
					}));
				setSlashSuggestions(filteredCommands);
			};

			if (cachedCommands) {
				applyCommands(cachedCommands);
				return;
			}

			setIsSlashSearchLoading(true);
			void (async () => {
				try {
					const payload = await getRuntimeTrpcClient(workspaceId).runtime.getClineSlashCommands.query();
					if (requestId !== slashCommandsRequestIdRef.current) {
						return;
					}
					slashCommandsCacheRef.current.set(requestKey, payload.commands);
					applyCommands(payload.commands);
				} catch {
					if (requestId === slashCommandsRequestIdRef.current) {
						setSlashSuggestions([]);
					}
				} finally {
					if (requestId === slashCommandsRequestIdRef.current) {
						setIsSlashSearchLoading(false);
					}
				}
			})();
		},
		CLINE_CHAT_COMPOSER_COMPLETION_DEBOUNCE_MS,
		[activeToken, workspaceId],
	);

	const applySuggestion = useCallback(
		(suggestion: ClineComposerCompletionSuggestion, token: ActiveClineComposerToken) => {
			const next = applyClineComposerCompletion(draft, token, suggestion.insertText);
			onDraftChange(next.value);
			window.requestAnimationFrame(() => {
				const textarea = textareaRef.current;
				if (!textarea) {
					return;
				}
				textarea.focus();
				textarea.setSelectionRange(next.cursor, next.cursor);
				setCursorIndex(next.cursor);
			});
		},
		[draft, onDraftChange],
	);

	const handleCompletionSelect = useCallback(
		(item: InlineCompletionItem) => {
			const suggestion = completionSuggestions.find((s) => s.id === item.id);
			if (suggestion && activeToken) {
				applySuggestion(suggestion, activeToken);
			}
		},
		[activeToken, applySuggestion, completionSuggestions],
	);

	const handleTextareaKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			if (event.nativeEvent.isComposing) {
				return;
			}
			const canNavigateCompletions = showCompletionPicker && completionSuggestions.length > 0;
			if (canNavigateCompletions && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
				event.preventDefault();
				const direction = event.key === "ArrowDown" ? 1 : -1;
				setSelectedCompletionIndex((currentValue) => {
					const nextIndex = currentValue + direction;
					if (nextIndex < 0) {
						return completionSuggestions.length - 1;
					}
					if (nextIndex >= completionSuggestions.length) {
						return 0;
					}
					return nextIndex;
				});
				return;
			}
			if (canNavigateCompletions && (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey))) {
				event.preventDefault();
				const selectedSuggestion = completionSuggestions[selectedCompletionIndex] ?? completionSuggestions[0];
				if (selectedSuggestion && activeToken) {
					applySuggestion(selectedSuggestion, activeToken);
				}
				return;
			}
			if (event.key === "Escape" && showCompletionPicker) {
				event.preventDefault();
				setIsCompletionPickerOpen(false);
				return;
			}
			if (
				showModeToggle &&
				(event.metaKey || event.ctrlKey) &&
				event.shiftKey &&
				!event.altKey &&
				event.key.toLowerCase() === "a"
			) {
				event.preventDefault();
				onModeChange(mode === "plan" ? "act" : "plan");
				return;
			}
			if (event.key === "Escape") {
				if (!canCancel) {
					return;
				}
				event.preventDefault();
				onCancel();
				return;
			}
			if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
				return;
			}
			if (!canSubmit) {
				return;
			}
			event.preventDefault();
			void onSend();
		},
		[
			activeToken,
			applySuggestion,
			canCancel,
			canSubmit,
			completionSuggestions,
			onCancel,
			onModeChange,
			onSend,
			mode,
			selectedCompletionIndex,
			showCompletionPicker,
			showModeToggle,
		],
	);

	const handleDrop = useCallback(
		async (event: DragEvent<HTMLDivElement>) => {
			event.preventDefault();
			setIsDragOver(false);
			const nextImages = await extractImagesFromDataTransfer(event.dataTransfer);
			appendImages(nextImages);
		},
		[appendImages],
	);

	return (
		<div
			className={cn(
				"rounded-xl border border-border bg-surface-2 px-3 py-2 focus-within:border-border-focus",
				isDragOver && "border-border-focus bg-surface-3/50",
			)}
			onDragEnter={(event) => {
				event.preventDefault();
				setIsDragOver(true);
			}}
			onDragOver={(event) => {
				event.preventDefault();
				setIsDragOver(true);
			}}
			onDragLeave={(event) => {
				if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
					return;
				}
				setIsDragOver(false);
			}}
			onDrop={handleDrop}
		>
			<InlineCompletionPicker
				open={showCompletionPicker}
				items={completionItems}
				selectedIndex={selectedCompletionIndex}
				onSelectItem={handleCompletionSelect}
				onHoverItem={setSelectedCompletionIndex}
				isLoading={isCompletionLoading}
				loadingMessage={completionLoadingMessage}
				emptyMessage={completionEmptyMessage}
				side="top"
			>
				<textarea
					ref={textareaRef}
					value={draft}
					onChange={(event) => {
						onDraftChange(event.target.value);
						setCursorIndex(event.target.selectionStart ?? event.target.value.length);
					}}
					onPaste={handlePaste}
					onKeyDown={handleTextareaKeyDown}
					onClick={(event) =>
						setCursorIndex(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
					}
					onKeyUp={(event) =>
						setCursorIndex(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
					}
					placeholder={placeholder}
					disabled={!canSend}
					rows={1}
					className="w-full min-h-6 resize-none bg-transparent p-0 text-sm leading-5 text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:opacity-50"
					style={{ maxHeight: CLINE_CHAT_COMPOSER_MAX_HEIGHT }}
				/>
			</InlineCompletionPicker>
			{images.length > 0 ? (
				<TaskImageStrip images={images} onRemoveImage={handleRemoveImage} className="mt-2" />
			) : null}
			<div className="mt-2 flex min-w-0 items-center gap-2">
				<div className="min-w-0 shrink overflow-hidden">
					<ClineChatModelSelector
						modelOptions={modelOptions}
						recommendedModelIds={recommendedModelIds}
						pinSelectedModelToTop={pinSelectedModelToTop}
						selectedModelId={selectedModelId}
						selectedModelButtonText={selectedModelButtonText}
						onSelectModel={onSelectModel}
						reasoningEnabledModelIds={reasoningEnabledModelIds}
						selectedReasoningEffort={selectedReasoningEffort}
						onSelectReasoningEffort={onSelectReasoningEffort}
						disabled={modelPickerDisabled}
						isModelLoading={isModelLoading}
						isModelSaving={isModelSaving}
					/>
				</div>
				<div className="ml-auto flex shrink-0 items-center gap-2">
					{showModeToggle ? (
						<Tooltip
							side="top"
							content={
								<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
									<span>Toggle</span>
									<span className="inline-flex items-center gap-0.5 whitespace-nowrap">
										<span>(</span>
										{isMacPlatform ? <Command size={11} /> : <span>Ctrl</span>}
										<span>+</span>
										<ArrowBigUp size={11} />
										<span>+ A)</span>
									</span>
								</span>
							}
						>
							<div
								className="inline-flex h-7 shrink-0 items-center rounded-md border border-border-bright bg-surface-3 p-0.5"
								role="tablist"
								aria-label="Cline mode"
							>
								<button
									type="button"
									role="tab"
									aria-selected={mode === "plan"}
									className={cn(
										"h-5 rounded-sm px-2 text-[11px] font-medium hover:cursor-pointer",
										mode === "plan"
											? "bg-surface-1 text-text-primary"
											: "text-text-secondary hover:bg-surface-4 hover:text-text-primary",
									)}
									onClick={() => onModeChange("plan")}
								>
									Plan
								</button>
								<button
									type="button"
									role="tab"
									aria-selected={mode === "act"}
									className={cn(
										"h-5 rounded-sm px-2 text-[11px] font-medium hover:cursor-pointer",
										mode === "act"
											? "bg-surface-1 text-text-primary"
											: "text-text-secondary hover:bg-surface-4 hover:text-text-primary",
									)}
									onClick={() => onModeChange("act")}
								>
									Act
								</button>
							</div>
						</Tooltip>
					) : null}
					<Button
						variant="default"
						size="sm"
						className="h-7 w-7 rounded-full border-border-bright bg-surface-4 p-0 text-text-primary hover:bg-surface-3"
						aria-label={canCancel ? "Cancel request" : "Send message"}
						disabled={canCancel ? false : !canSubmit}
						onClick={() => {
							if (canCancel) {
								onCancel();
								return;
							}
							void onSend();
						}}
						icon={
							isSending ? <Spinner size={12} /> : canCancel ? <Pause size={14} /> : <SendHorizontal size={14} />
						}
					/>
				</div>
			</div>
			{warningMessage ? (
				<div className="mt-2 flex items-start gap-1.5 text-xs text-status-orange" title={warningMessage}>
					<AlertTriangle size={14} className="mt-0.5 shrink-0" />
					<p
						className="m-0 min-w-0"
						style={{
							display: "-webkit-box",
							WebkitBoxOrient: "vertical",
							WebkitLineClamp: 2,
							overflow: "hidden",
						}}
					>
						{warningMessage}
					</p>
				</div>
			) : null}
			{attachmentWarningMessage ? (
				<div className="mt-2 flex items-start gap-1.5 text-xs text-status-orange" title={attachmentWarningMessage}>
					<AlertTriangle size={14} className="mt-0.5 shrink-0" />
					<p className="m-0 min-w-0">{attachmentWarningMessage}</p>
				</div>
			) : null}
		</div>
	);
}
