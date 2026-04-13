import * as RadixCheckbox from "@radix-ui/react-checkbox";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as RadixSwitch from "@radix-ui/react-switch";
import { deriveTaskTitleFromPrompt } from "@runtime-task-title";
import {
	ArrowBigUp,
	ArrowLeft,
	Check,
	ChevronDown,
	Command,
	CornerDownLeft,
	List,
	Option,
	PencilLine,
	Plus,
	X,
} from "lucide-react";
import type { Dispatch, ReactElement, SetStateAction } from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import type { BranchSelectOption } from "@/components/branch-select-dropdown";
import { BranchSelectDropdown } from "@/components/branch-select-dropdown";
import { TaskAgentModelPicker, useTaskAgentModelPicker } from "@/components/task-agent-model-picker";
import { TaskPromptComposer } from "@/components/task-prompt-composer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import type { RuntimeAgentId, RuntimeClineReasoningEffort, RuntimeTaskClineSettings } from "@/runtime/types";
import { LocalStorageKey } from "@/storage/local-storage-store";
import type { TaskAutoReviewMode, TaskImage } from "@/types";
import { isMacPlatform, pasteShortcutLabel } from "@/utils/platform";
import { useRawLocalStorageValue } from "@/utils/react-use";

const AUTO_REVIEW_MODE_OPTIONS: Array<{ value: TaskAutoReviewMode; label: string }> = [
	{ value: "commit", label: "Make commit" },
	{ value: "pr", label: "Make PR" },
	{ value: "move_to_trash", label: "Move to Trash" },
];

type TaskCreateStartAction = "start" | "start_and_open";

const DEFAULT_PRIMARY_START_ACTION: TaskCreateStartAction = "start";

function normalizeStoredTaskCreateStartAction(value: string): TaskCreateStartAction | null {
	if (value === "start" || value === "start_and_open") {
		return value;
	}
	return null;
}

function ButtonShortcut({
	includeShift = false,
	modifier = "mod",
}: {
	includeShift?: boolean;
	modifier?: "mod" | "alt";
}): ReactElement {
	return (
		<span className="inline-flex items-center gap-0.5 ml-1.5" aria-hidden>
			{modifier === "alt" ? (
				isMacPlatform ? (
					<Option size={12} />
				) : (
					<span className="text-[10px] font-medium leading-none">Alt</span>
				)
			) : (
				<Command size={12} />
			)}
			{includeShift ? <ArrowBigUp size={12} /> : null}
			<CornerDownLeft size={12} />
		</span>
	);
}

function parseListItems(text: string): string[] {
	const lines = text.split("\n");
	const nonEmptyLines = lines.filter((line) => line.trim().length > 0);

	if (nonEmptyLines.length < 2) {
		return [];
	}

	const numberedRegex = /^\s*\d+[.)]\s+(.+)$/;
	const numberedItems = nonEmptyLines.map((line) => numberedRegex.exec(line));
	if (numberedItems.every((match) => match !== null)) {
		return numberedItems.map((match) => match[1]!.trim());
	}

	const bulletRegex = /^\s*[-*+•]\s+(.+)$/;
	const bulletItems = nonEmptyLines.map((line) => bulletRegex.exec(line));
	if (bulletItems.every((match) => match !== null)) {
		return bulletItems.map((match) => match[1]!.trim());
	}

	return [];
}

export function TaskCreateDialog({
	open,
	onOpenChange,
	title,
	onTitleChange,
	prompt,
	onPromptChange,
	images,
	onImagesChange,
	onCreate,
	onCreateAndStart,
	onCreateMultiple,
	onCreateAndStartMultiple,
	onCreateStartAndOpen,
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
	agentId,
	onAgentIdChange,
	clineSettings,
	onClineSettingsChange,
	defaultAgentId,
	defaultProviderId,
	defaultModelId,
	defaultReasoningEffort,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	onTitleChange: (value: string) => void;
	prompt: string;
	onPromptChange: (value: string) => void;
	images: TaskImage[];
	onImagesChange: Dispatch<SetStateAction<TaskImage[]>>;
	onCreate: (options?: { keepDialogOpen?: boolean }) => string | null;
	onCreateAndStart?: (options?: { keepDialogOpen?: boolean }) => string | null;
	onCreateMultiple: (prompts: string[], options?: { keepDialogOpen?: boolean }) => string[];
	onCreateAndStartMultiple?: (prompts: string[], options?: { keepDialogOpen?: boolean }) => string[];
	onCreateStartAndOpen?: (options?: { keepDialogOpen?: boolean }) => string | null;
	startInPlanMode: boolean;
	onStartInPlanModeChange: (value: boolean) => void;
	autoReviewEnabled: boolean;
	onAutoReviewEnabledChange: (value: boolean) => void;
	autoReviewMode: TaskAutoReviewMode;
	onAutoReviewModeChange: (value: TaskAutoReviewMode) => void;
	startInPlanModeDisabled?: boolean;
	workspaceId: string | null;
	branchRef: string;
	branchOptions: BranchSelectOption[];
	onBranchRefChange: (value: string) => void;
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
	const [mode, setMode] = useState<"single" | "multi">("single");
	const [createMore, setCreateMore] = useState(false);
	const [composerResetKey, setComposerResetKey] = useState(0);
	const [taskPrompts, setTaskPrompts] = useState<string[]>([]);
	const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
	const nextFocusIndexRef = useRef<number | null>(null);
	const startInPlanModeId = useId();
	const autoReviewEnabledId = useId();
	const createMoreId = useId();
	const [primaryStartAction, setPrimaryStartAction] = useRawLocalStorageValue<TaskCreateStartAction>(
		LocalStorageKey.TaskCreatePrimaryStartAction,
		DEFAULT_PRIMARY_START_ACTION,
		normalizeStoredTaskCreateStartAction,
	);

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
		active: open,
		workspaceId,
		agentId,
		clineSettings,
		defaultAgentId,
		defaultProviderId,
		defaultModelId,
	});

	const detectedItems = useMemo(() => parseListItems(prompt), [prompt]);
	const validTaskCount = useMemo(() => taskPrompts.filter((p) => p.trim()).length, [taskPrompts]);
	const effectivePrimaryStartAction =
		onCreateStartAndOpen || primaryStartAction === "start" ? primaryStartAction : DEFAULT_PRIMARY_START_ACTION;
	const secondaryStartAction = effectivePrimaryStartAction === "start" ? "start_and_open" : "start";

	// Reset state when dialog closes
	useEffect(() => {
		if (!open) {
			setMode("single");
			setCreateMore(false);
			setComposerResetKey(0);
			setTaskPrompts([]);
			inputRefs.current = [];
			nextFocusIndexRef.current = null;
		}
	}, [open]);

	// Handle pending focus after render
	useEffect(() => {
		if (nextFocusIndexRef.current !== null) {
			const idx = nextFocusIndexRef.current;
			nextFocusIndexRef.current = null;
			requestAnimationFrame(() => {
				inputRefs.current[idx]?.focus();
			});
		}
	});

	const handleSplitIntoTasks = useCallback(() => {
		setTaskPrompts(detectedItems);
		setMode("multi");
		nextFocusIndexRef.current = 0;
	}, [detectedItems]);

	const handleBackToSingle = useCallback(() => {
		const joined = taskPrompts
			.filter((p) => p.trim())
			.map((p, i) => `${i + 1}. ${p}`)
			.join("\n");
		onPromptChange(joined);
		setMode("single");
		setTaskPrompts([]);
	}, [taskPrompts, onPromptChange]);

	const handleUpdateTaskPrompt = useCallback((index: number, value: string) => {
		setTaskPrompts((prev) => {
			const next = [...prev];
			next[index] = value;
			return next;
		});
	}, []);

	const handleRemoveTask = useCallback((index: number) => {
		setTaskPrompts((prev) => {
			if (prev.length <= 1) {
				return prev;
			}
			nextFocusIndexRef.current = Math.min(index, prev.length - 2);
			return prev.filter((_, i) => i !== index);
		});
	}, []);

	const handleAddTask = useCallback((afterIndex?: number) => {
		setTaskPrompts((prev) => {
			const insertIndex = afterIndex !== undefined ? afterIndex + 1 : prev.length;
			nextFocusIndexRef.current = insertIndex;
			const next = [...prev];
			next.splice(insertIndex, 0, "");
			return next;
		});
	}, []);

	const getValidPrompts = useCallback(() => {
		return taskPrompts.filter((p) => p.trim());
	}, [taskPrompts]);

	const resetForCreateMore = useCallback(() => {
		onPromptChange("");
		onImagesChange([]);
		setMode("single");
		setTaskPrompts([]);
		inputRefs.current = [];
		nextFocusIndexRef.current = null;
		setComposerResetKey((current) => current + 1);
	}, [onImagesChange, onPromptChange]);

	const handleCreateSingle = useCallback(() => {
		const createdTaskId = onCreate({ keepDialogOpen: createMore });
		if (createMore && createdTaskId) {
			resetForCreateMore();
		}
	}, [createMore, onCreate, resetForCreateMore]);

	const handleCreateAndStartSingle = useCallback(() => {
		const createdTaskId = onCreateAndStart?.({ keepDialogOpen: createMore });
		if (createMore && createdTaskId) {
			resetForCreateMore();
		}
	}, [createMore, onCreateAndStart, resetForCreateMore]);

	const handleCreateStartAndOpenSingle = useCallback(() => {
		const createdTaskId = onCreateStartAndOpen?.({ keepDialogOpen: createMore });
		if (createMore && createdTaskId) {
			resetForCreateMore();
		}
	}, [createMore, onCreateStartAndOpen, resetForCreateMore]);

	const handleRunSingleStartAction = useCallback(
		(action: TaskCreateStartAction) => {
			setPrimaryStartAction(action);
			if (action === "start_and_open") {
				handleCreateStartAndOpenSingle();
				return;
			}
			handleCreateAndStartSingle();
		},
		[handleCreateAndStartSingle, handleCreateStartAndOpenSingle, setPrimaryStartAction],
	);

	const handleCreateAll = useCallback(() => {
		const validPrompts = getValidPrompts();
		if (validPrompts.length === 0) {
			return;
		}
		const createdTaskIds = onCreateMultiple(validPrompts, { keepDialogOpen: createMore });
		if (createMore && createdTaskIds.length > 0) {
			resetForCreateMore();
		}
	}, [createMore, getValidPrompts, onCreateMultiple, resetForCreateMore]);

	const handleCreateAndStartAll = useCallback(() => {
		const validPrompts = getValidPrompts();
		if (validPrompts.length === 0) {
			return;
		}
		const createdTaskIds = onCreateAndStartMultiple?.(validPrompts, { keepDialogOpen: createMore }) ?? [];
		if (createMore && createdTaskIds.length > 0) {
			resetForCreateMore();
		}
	}, [createMore, getValidPrompts, onCreateAndStartMultiple, resetForCreateMore]);

	const handleInputKeyDown = useCallback(
		(index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
			if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				if (event.shiftKey) {
					handleCreateAndStartAll();
					return;
				}
				handleCreateAll();
				return;
			}
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				handleAddTask(index);
				return;
			}
			if (event.key === "Backspace" && taskPrompts[index] === "" && taskPrompts.length > 1) {
				event.preventDefault();
				handleRemoveTask(index);
			}
		},
		[handleAddTask, handleCreateAll, handleCreateAndStartAll, handleRemoveTask, taskPrompts],
	);

	const setInputRef = useCallback((index: number, el: HTMLInputElement | null) => {
		inputRefs.current[index] = el;
	}, []);

	// Cmd/Ctrl+Enter (and Cmd/Ctrl+Shift+Enter) from anywhere in the dialog.
	useHotkeys(
		"mod+enter, mod+shift+enter",
		(event) => {
			if (mode === "multi") {
				if (event.shiftKey) {
					handleCreateAndStartAll();
					return;
				}
				handleCreateAll();
				return;
			}
			if (event.shiftKey) {
				handleRunSingleStartAction("start");
				return;
			}
			handleCreateSingle();
		},
		{
			enabled: open,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			ignoreEventWhen: (event) => {
				if (!event.defaultPrevented) return false;
				// Only skip when a textarea or input already handled the shortcut.
				// Radix checkbox also calls preventDefault() on Enter, but that
				// should not block the dialog-level shortcut.
				const tag = (event.target as HTMLElement).tagName?.toLowerCase();
				return tag === "textarea" || tag === "input";
			},
			preventDefault: true,
		},
		[open, mode, handleCreateAll, handleCreateAndStartAll, handleCreateSingle, handleRunSingleStartAction],
	);

	// Alt/Opt+Shift+Enter → Start & Open (single mode only)
	useHotkeys(
		"alt+shift+enter",
		() => {
			if (mode === "single") {
				handleRunSingleStartAction("start_and_open");
			}
		},
		{
			enabled: open && Boolean(onCreateStartAndOpen),
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
		[open, mode, handleRunSingleStartAction, onCreateStartAndOpen],
	);

	const dialogTitle = mode === "multi" ? `New tasks${validTaskCount > 0 ? ` (${validTaskCount})` : ""}` : "New task";

	const taskCountLabel = validTaskCount === 1 ? "task" : "tasks";
	const primaryStartLabel = effectivePrimaryStartAction === "start" ? "Start task" : "Start and open";
	const primaryStartShortcutModifier = effectivePrimaryStartAction === "start" ? "mod" : "alt";
	const secondaryStartLabel = secondaryStartAction === "start" ? "Start task" : "Start and open";
	const secondaryStartShortcutModifier = secondaryStartAction === "start" ? "mod" : "alt";

	return (
		<Dialog open={open} onOpenChange={onOpenChange} contentClassName="max-w-2xl">
			<DialogHeader title={dialogTitle} icon={<PencilLine size={16} />} />
			<DialogBody>
				{mode === "single" ? (
					<div>
						<div className="mb-3">
							<label htmlFor="task-title-input" className="mb-1 block text-[12px] text-text-secondary">
								Title
							</label>
							<input
								id="task-title-input"
								value={title}
								onChange={(event) => onTitleChange(event.currentTarget.value)}
								placeholder={deriveTaskTitleFromPrompt(prompt) || "Auto-generated from prompt"}
								className="h-9 w-full rounded-md border border-border-bright bg-surface-2 px-3 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
							/>
						</div>
						<TaskPromptComposer
							key={composerResetKey}
							value={prompt}
							onValueChange={onPromptChange}
							images={images}
							onImagesChange={onImagesChange}
							onSubmit={handleCreateSingle}
							onSubmitAndStart={() => handleRunSingleStartAction("start")}
							placeholder="Describe the task..."
							autoFocus
							workspaceId={workspaceId}
							showAttachImageButton={false}
						/>
						<div className="flex items-center justify-between mt-1.5">
							<p className="text-[11px] text-text-tertiary">
								Use <code className="rounded bg-surface-3 px-1 py-px font-mono text-[11px]">@file</code> to
								reference files. Drag and drop or{" "}
								<code className="rounded bg-surface-3 px-1 py-px font-mono text-[11px]">
									{pasteShortcutLabel}
								</code>{" "}
								to add images.
							</p>
							{detectedItems.length >= 2 ? (
								<button
									type="button"
									onClick={handleSplitIntoTasks}
									className="inline-flex items-center gap-1.5 text-[12px] text-status-blue hover:text-[#86BEFF] cursor-pointer shrink-0"
								>
									<List size={12} />
									Split into {detectedItems.length} tasks
								</button>
							) : null}
						</div>
					</div>
				) : (
					<div>
						<div className="flex flex-col gap-1.5">
							{taskPrompts.map((taskPrompt, index) => (
								<div key={index} className="flex items-center gap-1.5">
									<span className="text-[12px] text-text-tertiary text-right shrink-0 tabular-nums">
										{index + 1}.
									</span>
									<input
										ref={(el) => setInputRef(index, el)}
										type="text"
										value={taskPrompt}
										onChange={(e) => handleUpdateTaskPrompt(index, e.target.value)}
										onKeyDown={(e) => handleInputKeyDown(index, e)}
										placeholder="Describe the task..."
										className="flex-1 min-w-0 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
									/>
									<Button
										variant="ghost"
										size="sm"
										icon={<X size={14} />}
										onClick={() => handleRemoveTask(index)}
										aria-label={`Remove task ${index + 1}`}
									/>
								</div>
							))}
						</div>
						<div className="flex items-center justify-between mt-3">
							<button
								type="button"
								onClick={() => handleAddTask()}
								className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary hover:text-text-primary cursor-pointer"
							>
								<Plus size={12} />
								Add task
							</button>
							<button
								type="button"
								onClick={handleBackToSingle}
								className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary hover:text-text-primary cursor-pointer"
							>
								<ArrowLeft size={12} />
								Back to single prompt
							</button>
						</div>
					</div>
				)}

				<div className="flex flex-col gap-2.5 mt-4 pt-4 border-t border-border">
					<label
						htmlFor={startInPlanModeId}
						className="flex items-center gap-2 text-[12px] text-text-primary cursor-pointer select-none"
					>
						<RadixCheckbox.Root
							id={startInPlanModeId}
							checked={startInPlanMode}
							onCheckedChange={(checked) => onStartInPlanModeChange(checked === true)}
							disabled={startInPlanModeDisabled}
							className="flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent disabled:cursor-default disabled:opacity-40"
						>
							<RadixCheckbox.Indicator>
								<Check size={10} className="text-white" />
							</RadixCheckbox.Indicator>
						</RadixCheckbox.Root>
						Start in plan mode
					</label>

					<div>
						<span className="text-[11px] text-text-secondary block mb-1">Worktree base ref</span>
						<BranchSelectDropdown
							options={branchOptions}
							selectedValue={branchRef}
							onSelect={onBranchRefChange}
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
								checked={autoReviewEnabled}
								onCheckedChange={(checked) => onAutoReviewEnabledChange(checked === true)}
								className="flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
							>
								<RadixCheckbox.Indicator>
									<Check size={10} className="text-white" />
								</RadixCheckbox.Indicator>
							</RadixCheckbox.Root>
							Automatically
						</label>
						<NativeSelect
							size="sm"
							value={autoReviewMode}
							onChange={(e) => onAutoReviewModeChange(e.currentTarget.value as TaskAutoReviewMode)}
							style={{ width: "16ch", maxWidth: "100%" }}
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
						/>
					) : null}
				</div>
			</DialogBody>
			<DialogFooter>
				<label
					htmlFor={createMoreId}
					className="mr-auto flex items-center gap-2 text-[12px] text-text-primary cursor-pointer select-none"
				>
					<RadixSwitch.Root
						id={createMoreId}
						checked={createMore}
						onCheckedChange={setCreateMore}
						className="relative h-5 w-9 rounded-full bg-surface-4 data-[state=checked]:bg-accent cursor-pointer"
					>
						<RadixSwitch.Thumb className="block h-4 w-4 rounded-full bg-white shadow-sm transition-transform translate-x-0.5 data-[state=checked]:translate-x-[18px]" />
					</RadixSwitch.Root>
					<span>Create more</span>
				</label>
				{mode === "single" ? (
					<>
						<Button size="sm" onClick={handleCreateSingle} disabled={!prompt.trim() || !branchRef}>
							<span className="inline-flex items-center">
								Create
								<ButtonShortcut />
							</span>
						</Button>
						{onCreateAndStart ? (
							<DropdownMenu.Root>
								<div className="inline-flex items-center">
									<Button
										variant="primary"
										size="sm"
										onClick={() => handleRunSingleStartAction(primaryStartAction)}
										disabled={!prompt.trim() || !branchRef}
										className={onCreateStartAndOpen ? "rounded-r-none" : undefined}
									>
										<span className="inline-flex items-center">
											{primaryStartLabel}
											<ButtonShortcut includeShift modifier={primaryStartShortcutModifier} />
										</span>
									</Button>
									{onCreateStartAndOpen ? (
										<DropdownMenu.Trigger asChild>
											<Button
												variant="primary"
												size="sm"
												disabled={!prompt.trim() || !branchRef}
												className="rounded-l-none border-l border-white/20 px-1"
												aria-label="More start options"
											>
												<ChevronDown size={12} />
											</Button>
										</DropdownMenu.Trigger>
									) : null}
								</div>
								<DropdownMenu.Portal>
									<DropdownMenu.Content
										side="bottom"
										align="end"
										sideOffset={4}
										className="z-50 rounded-md border border-border-bright bg-surface-1 p-1 shadow-lg"
										onCloseAutoFocus={(event) => event.preventDefault()}
									>
										<DropdownMenu.Item
											className="flex items-center justify-between gap-2 rounded-sm px-2 py-1 text-[12px] text-text-primary cursor-pointer outline-none data-[highlighted]:bg-surface-3 whitespace-nowrap"
											onSelect={() => handleRunSingleStartAction(secondaryStartAction)}
										>
											{secondaryStartLabel}
											<span className="inline-flex items-center gap-0.5 text-text-tertiary" aria-hidden>
												{secondaryStartShortcutModifier === "alt" ? (
													isMacPlatform ? (
														<Option size={10} />
													) : (
														<span className="text-[10px] font-medium leading-none">Alt</span>
													)
												) : (
													<Command size={10} />
												)}
												<ArrowBigUp size={10} />
												<CornerDownLeft size={10} />
											</span>
										</DropdownMenu.Item>
									</DropdownMenu.Content>
								</DropdownMenu.Portal>
							</DropdownMenu.Root>
						) : null}
					</>
				) : (
					<>
						<Button size="sm" onClick={handleCreateAll} disabled={validTaskCount === 0 || !branchRef}>
							<span className="inline-flex items-center">
								Create {validTaskCount} {taskCountLabel}
								<ButtonShortcut />
							</span>
						</Button>
						{onCreateAndStartMultiple ? (
							<Button
								variant="primary"
								size="sm"
								onClick={handleCreateAndStartAll}
								disabled={validTaskCount === 0 || !branchRef}
							>
								<span className="inline-flex items-center">
									Start {validTaskCount} {taskCountLabel}
									<ButtonShortcut includeShift />
								</span>
							</Button>
						) : null}
					</>
				)}
			</DialogFooter>
		</Dialog>
	);
}
