import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { deriveTaskTitleFromPrompt } from "@runtime-task-title";
import { ArrowBigUp, Check, Command, CornerDownLeft } from "lucide-react";
import { type Dispatch, type ReactElement, type SetStateAction, useCallback, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { BranchSelectDropdown, type BranchSelectOption } from "@/components/branch-select-dropdown";
import { TaskAgentModelPicker, useTaskAgentModelPicker } from "@/components/task-agent-model-picker";
import { TaskPromptComposer } from "@/components/task-prompt-composer";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { RuntimeAgentId, RuntimeClineReasoningEffort, RuntimeTaskClineSettings } from "@/runtime/types";
import type { TaskAutoReviewMode, TaskImage } from "@/types";
import { pasteShortcutLabel } from "@/utils/platform";
import { useDocumentEvent, useMeasure } from "@/utils/react-use";

export type TaskInlineCardMode = "create" | "edit";

export type TaskBranchOption = BranchSelectOption;

const AUTO_REVIEW_MODE_OPTIONS: Array<{ value: TaskAutoReviewMode; label: string }> = [
	{ value: "commit", label: "Make commit" },
	{ value: "pr", label: "Make PR" },
	{ value: "move_to_trash", label: "Move to Trash" },
];
const AUTO_REVIEW_MODE_SELECT_WIDTH_CH = 16;
const COMPACT_ACTIONS_WIDTH_THRESHOLD_PX = 280;

function ButtonShortcut({ includeShift = false }: { includeShift?: boolean }): ReactElement {
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 2,
				marginLeft: 6,
			}}
			aria-hidden
		>
			<Command size={12} />
			{includeShift ? <ArrowBigUp size={12} /> : null}
			<CornerDownLeft size={12} />
		</span>
	);
}

export function TaskInlineCreateCard({
	title,
	onTitleChange,
	prompt,
	onPromptChange,
	images,
	onImagesChange,
	onCreate,
	onCreateAndStart,
	onCancel,
	startInPlanMode,
	onStartInPlanModeChange,
	autoReviewEnabled,
	onAutoReviewEnabledChange,
	autoReviewMode,
	onAutoReviewModeChange,
	startInPlanModeDisabled = false,
	workspaceId,
	branchRef,
	branchOptions,
	onBranchRefChange,
	enabled = true,
	mode = "create",
	idPrefix = "inline-task",
	agentId,
	onAgentIdChange,
	clineSettings,
	onClineSettingsChange,
	defaultAgentId,
	defaultProviderId,
	defaultModelId,
	defaultReasoningEffort,
}: {
	title?: string;
	onTitleChange?: (value: string) => void;
	prompt: string;
	onPromptChange: (value: string) => void;
	images?: TaskImage[];
	onImagesChange?: Dispatch<SetStateAction<TaskImage[]>>;
	onCreate: () => void;
	onCreateAndStart?: () => void;
	onCancel?: () => void;
	startInPlanMode: boolean;
	onStartInPlanModeChange: (value: boolean) => void;
	autoReviewEnabled: boolean;
	onAutoReviewEnabledChange: (value: boolean) => void;
	autoReviewMode: TaskAutoReviewMode;
	onAutoReviewModeChange: (value: TaskAutoReviewMode) => void;
	startInPlanModeDisabled?: boolean;
	workspaceId: string | null;
	branchRef: string;
	branchOptions: TaskBranchOption[];
	onBranchRefChange: (value: string) => void;
	enabled?: boolean;
	mode?: TaskInlineCardMode;
	idPrefix?: string;
	agentId?: RuntimeAgentId | undefined;
	onAgentIdChange?: (value: RuntimeAgentId | undefined) => void;
	clineSettings?: RuntimeTaskClineSettings | undefined;
	onClineSettingsChange?: (value: RuntimeTaskClineSettings | undefined) => void;
	/** Default agent ID from runtimeConfig.selectedAgentId, used to show "Default (AgentName)" in picker */
	defaultAgentId?: RuntimeAgentId | null;
	/** Default Cline provider ID from runtimeConfig.clineProviderSettings.providerId */
	defaultProviderId?: string | null;
	/** Default Cline model ID from runtimeConfig.clineProviderSettings.modelId */
	defaultModelId?: string | null;
	/** Default Cline reasoning effort from runtimeConfig.clineProviderSettings.reasoningEffort */
	defaultReasoningEffort?: RuntimeClineReasoningEffort | null;
}): ReactElement {
	const promptId = `${idPrefix}-prompt-input`;
	const planModeId = `${idPrefix}-plan-mode-toggle`;
	const autoReviewEnabledId = `${idPrefix}-auto-review-enabled-toggle`;
	const autoReviewModeId = `${idPrefix}-auto-review-mode-select`;
	const branchSelectId = `${idPrefix}-branch-select`;
	const actionLabel = mode === "edit" ? "Save" : "Create";
	const [measureRef, cardRect] = useMeasure<HTMLDivElement>();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [isBranchPopoverOpen, setIsBranchPopoverOpen] = useState(false);
	const [isModelPickerPopoverOpen, setIsModelPickerPopoverOpen] = useState(false);
	const setCardRef = useCallback(
		(node: HTMLDivElement | null) => {
			containerRef.current = node;
			if (node) {
				measureRef(node);
			}
		},
		[measureRef],
	);
	const isCompactActions = cardRect.width > 0 && cardRect.width < COMPACT_ACTIONS_WIDTH_THRESHOLD_PX;
	const hideCancelShortcut = isCompactActions;
	const hideCreateShortcut = mode === "create" && isCompactActions;
	const cancelLabel = hideCancelShortcut ? "Cancel" : "Cancel (esc)";
	const cardMarginBottom = mode === "create" ? 6 : 0;

	const {
		agentOptions,
		clineProviderOptions,
		clineModelOptions,
		effectiveDefaultModelId,
		providerModels,
		isLoadingProviders,
		isLoadingModels,
		providerDefaultModels,
	} = useTaskAgentModelPicker({
		active: true,
		workspaceId,
		agentId,
		clineSettings,
		defaultAgentId,
		defaultProviderId,
		defaultModelId,
	});

	useHotkeys(
		"escape",
		(event) => {
			if (!onCancel) {
				return;
			}
			if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
				return;
			}
			onCancel();
		},
		{
			enabled: enabled && Boolean(onCancel),
			enableOnFormTags: true,
			enableOnContentEditable: true,
			ignoreEventWhen: (event) => event.defaultPrevented,
			preventDefault: true,
		},
		[enabled, mode, onCancel],
	);

	useDocumentEvent(
		"pointerdown",
		(event) => {
			if (!enabled || mode !== "edit" || isBranchPopoverOpen || isModelPickerPopoverOpen) {
				return;
			}
			const container = containerRef.current;
			if (!container) {
				return;
			}
			if (event.target instanceof Node && container.contains(event.target)) {
				return;
			}
			onCreate();
		},
		true,
	);

	return (
		<div
			ref={setCardRef}
			className="rounded-md border border-border-bright bg-surface-2 p-3"
			style={{ flexShrink: 0, marginBottom: cardMarginBottom, fontSize: 12 }}
		>
			<div>
				{onTitleChange ? (
					<div className="mb-2">
						<label htmlFor={`${idPrefix}-title-input`} className="mb-1 block text-[11px] text-text-secondary">
							Title
						</label>
						<input
							id={`${idPrefix}-title-input`}
							value={title ?? ""}
							onChange={(event) => onTitleChange(event.currentTarget.value)}
							placeholder={deriveTaskTitleFromPrompt(prompt) || "Auto-generated from prompt"}
							className="h-8 w-full rounded-md border border-border-bright bg-surface-2 px-2 text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
					</div>
				) : null}
				<TaskPromptComposer
					id={promptId}
					value={prompt}
					onValueChange={onPromptChange}
					images={images}
					onImagesChange={onImagesChange}
					onSubmit={onCreate}
					onSubmitAndStart={onCreateAndStart}
					onEscape={onCancel}
					placeholder="Describe the task..."
					enabled={enabled}
					autoFocus
					workspaceId={workspaceId}
					showAttachImageButton={false}
				/>
				<p className="text-[11px] text-text-tertiary mt-1 mb-0">
					Use <code className="rounded bg-surface-3 px-1 py-px font-mono text-[11px]">@file</code> to reference
					files. Drag and drop or{" "}
					<code className="rounded bg-surface-3 px-1 py-px font-mono text-[11px]">{pasteShortcutLabel}</code> to
					add images.
				</p>
			</div>

			<div className="flex flex-col gap-2 mt-3">
				<label
					htmlFor={planModeId}
					className="flex items-center gap-2 text-[12px] text-text-primary cursor-pointer select-none"
				>
					<RadixCheckbox.Root
						id={planModeId}
						aria-label="Start in plan mode"
						checked={startInPlanMode}
						onCheckedChange={(checked) => onStartInPlanModeChange(checked === true)}
						disabled={startInPlanModeDisabled || !enabled}
						className="flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent disabled:cursor-default disabled:opacity-40"
					>
						<RadixCheckbox.Indicator>
							<Check size={10} className="text-white" />
						</RadixCheckbox.Indicator>
					</RadixCheckbox.Root>
					<span>Start in plan mode</span>
				</label>

				<div>
					<span className="text-[11px] text-text-secondary block mb-1">Worktree base ref</span>
					<BranchSelectDropdown
						id={branchSelectId}
						options={branchOptions}
						selectedValue={branchRef}
						onSelect={onBranchRefChange}
						onPopoverOpenChange={setIsBranchPopoverOpen}
						fill
						size="sm"
						emptyText="No branches detected"
					/>
				</div>

				<div className="flex items-center gap-2 flex-wrap">
					<label
						htmlFor={autoReviewEnabledId}
						className="flex items-center gap-2 text-[12px] text-text-primary cursor-pointer select-none"
					>
						<RadixCheckbox.Root
							id={autoReviewEnabledId}
							aria-label="Enable automatic review action"
							checked={autoReviewEnabled}
							onCheckedChange={(checked) => onAutoReviewEnabledChange(checked === true)}
							className="flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
						>
							<RadixCheckbox.Indicator>
								<Check size={10} className="text-white" />
							</RadixCheckbox.Indicator>
						</RadixCheckbox.Root>
						<span>Automatically</span>
					</label>
					<NativeSelect
						id={autoReviewModeId}
						size="sm"
						value={autoReviewMode}
						onChange={(event) => onAutoReviewModeChange(event.currentTarget.value as TaskAutoReviewMode)}
						style={{
							width: `${AUTO_REVIEW_MODE_SELECT_WIDTH_CH}ch`,
							maxWidth: "100%",
						}}
					>
						{AUTO_REVIEW_MODE_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</NativeSelect>
				</div>
				{onAgentIdChange && onClineSettingsChange ? (
					<TaskAgentModelPicker
						agentId={agentId}
						onAgentIdChange={onAgentIdChange}
						clineSettings={clineSettings}
						onClineSettingsChange={onClineSettingsChange}
						agentOptions={agentOptions}
						clineProviderOptions={clineProviderOptions}
						clineModelOptions={clineModelOptions}
						effectiveDefaultModelId={effectiveDefaultModelId}
						providerModels={providerModels}
						isLoadingProviders={isLoadingProviders}
						isLoadingModels={isLoadingModels}
						defaultAgentId={defaultAgentId}
						defaultProviderId={defaultProviderId}
						defaultReasoningEffort={defaultReasoningEffort}
						providerDefaultModels={providerDefaultModels}
						onPopoverOpenChange={setIsModelPickerPopoverOpen}
					/>
				) : null}
			</div>

			<div className={`flex gap-2 mt-3 ${mode === "edit" ? "justify-end" : "justify-between"}`}>
				{mode === "create" && onCancel ? (
					<Button variant="default" size="sm" className="whitespace-nowrap" onClick={onCancel}>
						{cancelLabel}
					</Button>
				) : null}
				<div className="flex gap-2">
					<Button
						size="sm"
						className="whitespace-nowrap"
						onClick={onCreate}
						disabled={!prompt.trim() || !branchRef}
					>
						<span className="inline-flex items-center">
							<span>{actionLabel}</span>
							{hideCreateShortcut ? null : <ButtonShortcut />}
						</span>
					</Button>
					{onCreateAndStart ? (
						<Button
							variant="primary"
							size="sm"
							className="whitespace-nowrap"
							onClick={onCreateAndStart}
							disabled={!prompt.trim() || !branchRef}
						>
							<span className="inline-flex items-center">
								<span>Start</span>
								<ButtonShortcut includeShift />
							</span>
						</Button>
					) : null}
				</div>
			</div>
		</div>
	);
}
