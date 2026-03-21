import { AlertTriangle, ArrowBigUp, Command, Pause, SendHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type ReactElement } from "react";

import { SearchSelectDropdown, type SearchSelectOption } from "@/components/search-select-dropdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import type { RuntimeTaskSessionMode } from "@/runtime/types";

const CLINE_CHAT_COMPOSER_MAX_HEIGHT = 160;
const isMacPlatform =
	typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

export function ClineChatComposer({
	taskId,
	draft,
	onDraftChange,
	placeholder,
	mode,
	onModeChange,
	showModeToggle = true,
	canSend,
	canCancel,
	onSend,
	onCancel,
	modelOptions,
	selectedModelId,
	selectedModelButtonText,
	onSelectModel,
	isModelLoading = false,
	isModelSaving = false,
	modelPickerDisabled = false,
	isSending = false,
	warningMessage = null,
}: {
	taskId: string;
	draft: string;
	onDraftChange: (draft: string) => void;
	placeholder: string;
	mode: RuntimeTaskSessionMode;
	onModeChange: (mode: RuntimeTaskSessionMode) => void;
	showModeToggle?: boolean;
	canSend: boolean;
	canCancel: boolean;
	onSend: () => void | Promise<void>;
	onCancel: () => void;
	modelOptions: readonly SearchSelectOption[];
	selectedModelId: string;
	selectedModelButtonText: string;
	onSelectModel: (value: string) => void;
	isModelLoading?: boolean;
	isModelSaving?: boolean;
	modelPickerDisabled?: boolean;
	isSending?: boolean;
	warningMessage?: string | null;
}): ReactElement {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const canSubmit = canSend && !isModelSaving && draft.trim().length > 0;

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
		textareaRef.current?.focus();
	}, [canSend, taskId]);

	return (
		<div className="rounded-xl border border-border bg-surface-2 px-3 py-2 focus-within:border-border-focus">
			<textarea
				ref={textareaRef}
				value={draft}
				onChange={(event) => onDraftChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.nativeEvent.isComposing) {
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
				}}
				placeholder={placeholder}
				disabled={!canSend}
				rows={1}
				className="w-full min-h-6 resize-none bg-transparent p-0 text-sm leading-5 text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:opacity-50"
				style={{ maxHeight: CLINE_CHAT_COMPOSER_MAX_HEIGHT }}
			/>
			<div className="mt-2 flex min-w-0 items-center gap-2">
				<div className="min-w-0 shrink overflow-hidden">
					<SearchSelectDropdown
						id="cline-chat-model-picker"
						options={modelOptions}
						selectedValue={selectedModelId}
						onSelect={onSelectModel}
						disabled={modelPickerDisabled}
						size="sm"
						buttonText={selectedModelButtonText}
						emptyText="Select model"
						noResultsText="No matching models"
						placeholder="Search models..."
						showSelectedIndicator
						matchTargetWidth={false}
						collisionPadding={12}
						dropdownStyle={{ minWidth: "220px", maxWidth: "320px" }}
						buttonClassName={cn(
							"min-w-0 max-w-full justify-between rounded-md border-border-bright bg-surface-3 px-2 text-left text-text-secondary shadow-none hover:cursor-pointer hover:bg-surface-4 hover:text-text-primary",
							(isModelLoading || isModelSaving) && "text-text-tertiary",
						)}
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
							isSending ? (
								<Spinner size={12} />
							) : canCancel ? (
								<Pause size={14} />
							) : (
								<SendHorizontal size={14} />
							)
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
		</div>
	);
}
