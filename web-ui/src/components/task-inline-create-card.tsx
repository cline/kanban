import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { ArrowBigUp, Check, ChevronDown, Command, CornerDownLeft } from "lucide-react";
import { useCallback, useRef, useState, type Dispatch, type ReactElement, type SetStateAction } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { BranchSelectDropdown, type BranchSelectOption } from "@/components/branch-select-dropdown";
import { TaskPromptComposer } from "@/components/task-prompt-composer";
import { Button } from "@/components/ui/button";
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
}: {
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

	useHotkeys(
		"esc",
		(event) => {
			if (!onCancel || mode === "edit") {
				return;
			}
			if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
				return;
			}
			onCancel();
		},
		{
			enabled: enabled && Boolean(onCancel) && mode !== "edit",
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
			if (!enabled || mode !== "edit" || isBranchPopoverOpen) {
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
				<TaskPromptComposer
					id={promptId}
					value={prompt}
					onValueChange={onPromptChange}
					images={images}
					onImagesChange={onImagesChange}
					onSubmit={onCreate}
					onSubmitAndStart={onCreateAndStart}
					placeholder="Describe the task..."
					enabled={enabled}
					autoFocus
					workspaceId={workspaceId}
					showAttachImageButton={false}
				/>
				<p className="text-[11px] text-text-tertiary mt-1 mb-0">
					Use <code className="rounded bg-surface-3 px-1 py-px font-mono text-[11px]">@file</code> to reference
					files, and <code className="rounded bg-surface-3 px-1 py-px font-mono text-[11px]">{pasteShortcutLabel}</code> to paste
					images.
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
					<div className="relative inline-flex">
						<select
							id={autoReviewModeId}
							value={autoReviewMode}
							onChange={(event) => onAutoReviewModeChange(event.currentTarget.value as TaskAutoReviewMode)}
							className="h-7 appearance-none rounded-md border border-border-bright bg-surface-2 pl-2 pr-7 text-[12px] text-text-primary cursor-pointer focus:border-border-focus focus:outline-none"
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
						</select>
						<ChevronDown
							size={14}
							className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-text-secondary"
						/>
					</div>
				</div>
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
