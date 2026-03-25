import { Paperclip } from "lucide-react";
import type { ChangeEvent, ClipboardEvent, DragEvent, KeyboardEvent, ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	applyClineComposerCompletion,
	buildMentionInsertText,
	detectActiveClineComposerToken,
} from "@/components/detail-panels/cline-chat-composer-completion";
import { InlineCompletionPicker, type InlineCompletionItem } from "@/components/inline-completion-picker";
import { ACCEPTED_TASK_IMAGE_INPUT_ACCEPT, collectImageFilesFromDataTransfer, extractImagesFromDataTransfer, fileToTaskImage } from "@/components/task-image-input-utils";
import { TaskImageStrip } from "@/components/task-image-strip";
import { Button } from "@/components/ui/button";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { TaskImage } from "@/types";
import { useDebouncedEffect } from "@/utils/react-use";

const FILE_MENTION_LIMIT = 8;
const MENTION_QUERY_DEBOUNCE_MS = 120;
const TEXTAREA_MAX_HEIGHT = 200;

interface TaskPromptComposerProps {
	id?: string;
	value: string;
	onValueChange: (value: string) => void;
	images?: TaskImage[];
	onImagesChange?: (images: TaskImage[]) => void;
	onSubmit?: () => void;
	onSubmitAndStart?: () => void;
	onEscape?: () => void;
	placeholder?: string;
	disabled?: boolean;
	enabled?: boolean;
	autoFocus?: boolean;
	workspaceId?: string | null;
	showAttachImageButton?: boolean;
}

export function TaskPromptComposer({
	id,
	value,
	onValueChange,
	images = [],
	onImagesChange,
	onSubmit,
	onSubmitAndStart,
	onEscape,
	placeholder,
	disabled,
	enabled = true,
	autoFocus = false,
	workspaceId = null,
	showAttachImageButton = true,
}: TaskPromptComposerProps): ReactElement {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const mentionSearchRequestIdRef = useRef(0);
	const [cursorIndex, setCursorIndex] = useState(0);
	const [mentionItems, setMentionItems] = useState<InlineCompletionItem[]>([]);
	const [mentionInsertTextMap, setMentionInsertTextMap] = useState(new Map<string, string>());
	const [isMentionSearchLoading, setIsMentionSearchLoading] = useState(false);
	const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
	const [isSuggestionPickerOpen, setIsSuggestionPickerOpen] = useState(false);
	const [isDragOver, setIsDragOver] = useState(false);

	const autoResizeTextarea = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) {
			return;
		}
		textarea.style.height = "auto";
		textarea.style.height = `${Math.min(textarea.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
	}, []);

	useEffect(() => {
		autoResizeTextarea();
	}, [autoResizeTextarea, value]);

	const activeToken = useMemo(() => {
		const token = detectActiveClineComposerToken(value, cursorIndex);
		if (token && token.kind !== "mention") {
			return null;
		}
		return token;
	}, [cursorIndex, value]);

	useEffect(() => {
		if (!enabled || !activeToken) {
			mentionSearchRequestIdRef.current += 1;
			setMentionItems([]);
			setMentionInsertTextMap(new Map());
			setIsMentionSearchLoading(false);
		}
	}, [activeToken, enabled, workspaceId]);

	useDebouncedEffect(
		() => {
			if (!enabled || !activeToken || !workspaceId) {
				return;
			}
			const requestId = ++mentionSearchRequestIdRef.current;
			setIsMentionSearchLoading(true);
			void (async () => {
				try {
					const trpcClient = getRuntimeTrpcClient(workspaceId);
					const payload = await trpcClient.workspace.searchFiles.query({
						query: activeToken.query,
						limit: FILE_MENTION_LIMIT,
					});
					if (requestId !== mentionSearchRequestIdRef.current) {
						return;
					}
					const files = Array.isArray(payload.files) ? payload.files : [];
					const insertMap = new Map<string, string>();
					const items: InlineCompletionItem[] = files.map((file) => {
						const insertText = buildMentionInsertText(file.path);
						insertMap.set(file.path, insertText);
						return { id: file.path, label: file.path };
					});
					setMentionItems(items);
					setMentionInsertTextMap(insertMap);
				} catch {
					if (requestId === mentionSearchRequestIdRef.current) {
						setMentionItems([]);
						setMentionInsertTextMap(new Map());
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
		return enabled && activeToken ? mentionItems : [];
	}, [activeToken, enabled, mentionItems]);

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
		(item: InlineCompletionItem) => {
			if (!activeToken) {
				return;
			}
			const insertText = mentionInsertTextMap.get(item.id) ?? `@${item.id}`;
			const next = applyClineComposerCompletion(value, activeToken, insertText);
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
		[activeToken, mentionInsertTextMap, onValueChange, value],
	);

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
				const selectedItem = suggestions[selectedSuggestionIndex] ?? suggestions[0];
				if (selectedItem) {
					applySuggestion(selectedItem);
				}
				return;
			}

			if (event.key === "Escape" && canShowSuggestions) {
				event.preventDefault();
				setIsSuggestionPickerOpen(false);
				return;
			}

			if (event.key === "Escape") {
				event.preventDefault();
				onEscape?.();
			}
		},
		[applySuggestion, isSuggestionPickerOpen, onEscape, onSubmit, onSubmitAndStart, selectedSuggestionIndex, suggestions],
	);

	const appendImages = useCallback(
		(newImages: TaskImage[]) => {
			if (!onImagesChange || newImages.length === 0) {
				return;
			}
			onImagesChange([...images, ...newImages]);
		},
		[images, onImagesChange],
	);

	const handlePaste = useCallback(
		(event: ClipboardEvent<HTMLTextAreaElement>) => {
			if (!onImagesChange || !event.clipboardData) {
				return;
			}
			const imageFiles = collectImageFilesFromDataTransfer(event.clipboardData);
			if (imageFiles.length === 0) {
				return;
			}
			event.preventDefault();
			void (async () => {
				const newImages = await extractImagesFromDataTransfer(event.clipboardData);
				appendImages(newImages);
			})();
		},
		[appendImages, onImagesChange],
	);

	const handleDrop = useCallback(
		(event: DragEvent<HTMLTextAreaElement>) => {
			setIsDragOver(false);
			if (!onImagesChange || !event.dataTransfer) {
				return;
			}
			const imageFiles = collectImageFilesFromDataTransfer(event.dataTransfer);
			if (imageFiles.length === 0) {
				return;
			}
			event.preventDefault();
			void (async () => {
				const newImages = await extractImagesFromDataTransfer(event.dataTransfer);
				appendImages(newImages);
			})();
		},
		[appendImages, onImagesChange],
	);

	const handleDragOver = useCallback(
		(event: DragEvent<HTMLTextAreaElement>) => {
			if (!onImagesChange) {
				return;
			}
			const hasFiles = event.dataTransfer.types.includes("Files");
			if (!hasFiles) {
				return;
			}
			event.preventDefault();
			setIsDragOver(true);
		},
		[onImagesChange],
	);

	const handleDragLeave = useCallback(() => {
		setIsDragOver(false);
	}, []);

	const handleRemoveImage = useCallback(
		(imageId: string) => {
			onImagesChange?.(images.filter((image) => image.id !== imageId));
		},
		[images, onImagesChange],
	);

	const handleAttachClick = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	const handleFileInputChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			if (!onImagesChange || !event.currentTarget.files) {
				return;
			}
			const files = Array.from(event.currentTarget.files);
			void (async () => {
				const newImages: TaskImage[] = [];
				for (const file of files) {
					const image = await fileToTaskImage(file);
					if (image) {
						newImages.push(image);
					}
				}
				appendImages(newImages);
				event.currentTarget.value = "";
			})();
		},
		[appendImages, onImagesChange],
	);

	const showSuggestions = Boolean(enabled && isSuggestionPickerOpen && activeToken);

	return (
		<div>
			<InlineCompletionPicker
				open={showSuggestions}
				items={suggestions}
				selectedIndex={selectedSuggestionIndex}
				onSelectItem={applySuggestion}
				onHoverItem={setSelectedSuggestionIndex}
				isLoading={isMentionSearchLoading}
				loadingMessage="Loading files..."
				emptyMessage="No matching files."
			>
				<textarea
					id={id}
					ref={textareaRef}
					value={value}
					onChange={(event) => {
						onValueChange(event.target.value);
						setCursorIndex(event.target.selectionStart ?? event.target.value.length);
					}}
					onKeyDown={handleTextareaKeyDown}
					onClick={(event) =>
						setCursorIndex(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
					}
					onKeyUp={(event) =>
						setCursorIndex(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
					}
					onPaste={handlePaste}
					onDrop={handleDrop}
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					placeholder={placeholder ?? "Describe the task"}
					disabled={disabled}
					className="w-full rounded-md border border-border-bright bg-surface-3 p-3 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
					style={{
						minHeight: 80,
						maxHeight: TEXTAREA_MAX_HEIGHT,
						resize: "none",
						overflowY: "auto",
						...(isDragOver
							? {
								outline: "2px dashed var(--accent)",
								outlineOffset: -2,
							}
							: {}),
					}}
				/>
			</InlineCompletionPicker>

			{images.length > 0 ? (
				<TaskImageStrip
					images={images}
					onRemoveImage={handleRemoveImage}
					className="mt-1.5"
				/>
			) : null}

			{onImagesChange && showAttachImageButton ? (
				<>
					<input
						ref={fileInputRef}
						type="file"
						accept={ACCEPTED_TASK_IMAGE_INPUT_ACCEPT}
						multiple
						className="hidden"
						onChange={handleFileInputChange}
					/>
					<div className={images.length > 0 ? "mt-1" : "mt-1.5"}>
						<Button
							variant="ghost"
							size="sm"
							icon={<Paperclip size={14} />}
							onClick={handleAttachClick}
							disabled={disabled || !enabled}
						>
							Attach image
						</Button>
					</div>
				</>
			) : null}
		</div>
	);
}
