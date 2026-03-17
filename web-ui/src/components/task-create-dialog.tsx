import * as RadixCheckbox from "@radix-ui/react-checkbox";
import {
	ArrowBigUp,
	ArrowLeft,
	Check,
	ChevronDown,
	Command,
	CornerDownLeft,
	List,
	PencilLine,
	Plus,
	X,
} from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { TaskAgentSelect, type TaskAgentOption } from "@/components/task-agent-select";
import type { BranchSelectOption } from "@/components/branch-select-dropdown";
import { BranchSelectDropdown } from "@/components/branch-select-dropdown";
import { TaskPromptComposer } from "@/components/task-prompt-composer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import type { RuntimeAgentId } from "@/runtime/types";
import type { TaskAutoReviewMode } from "@/types";

const AUTO_REVIEW_MODE_OPTIONS: Array<{ value: TaskAutoReviewMode; label: string }> = [
	{ value: "commit", label: "Make commit" },
	{ value: "pr", label: "Make PR" },
	{ value: "move_to_trash", label: "Move to Trash" },
];

function ButtonShortcut({ includeShift = false }: { includeShift?: boolean }): ReactElement {
	return (
		<span className="inline-flex items-center gap-0.5 ml-1.5" aria-hidden>
			<Command size={12} />
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
	prompt,
	onPromptChange,
	onCreate,
	onCreateAndStart,
	onCreateMultiple,
	onCreateAndStartMultiple,
	startInPlanMode,
	onStartInPlanModeChange,
	autoReviewEnabled,
	onAutoReviewEnabledChange,
	autoReviewMode,
	onAutoReviewModeChange,
	agentId,
	agentOptions,
	onAgentIdChange,
	startInPlanModeDisabled = false,
	workspaceId,
	branchRef,
	branchOptions,
	onBranchRefChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	prompt: string;
	onPromptChange: (value: string) => void;
	onCreate: () => void;
	onCreateAndStart?: () => void;
	onCreateMultiple: (prompts: string[]) => void;
	onCreateAndStartMultiple?: (prompts: string[]) => void;
	startInPlanMode: boolean;
	onStartInPlanModeChange: (value: boolean) => void;
	autoReviewEnabled: boolean;
	onAutoReviewEnabledChange: (value: boolean) => void;
	autoReviewMode: TaskAutoReviewMode;
	onAutoReviewModeChange: (value: TaskAutoReviewMode) => void;
	agentId: RuntimeAgentId | null;
	agentOptions: TaskAgentOption[];
	onAgentIdChange: (value: RuntimeAgentId) => void;
	startInPlanModeDisabled?: boolean;
	workspaceId: string | null;
	branchRef: string;
	branchOptions: BranchSelectOption[];
	onBranchRefChange: (value: string) => void;
}): ReactElement {
	const [mode, setMode] = useState<"single" | "multi">("single");
	const [taskPrompts, setTaskPrompts] = useState<string[]>([]);
	const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
	const nextFocusIndexRef = useRef<number | null>(null);
	const startInPlanModeId = useId();
	const autoReviewEnabledId = useId();
	const agentSelectId = useId();

	const detectedItems = useMemo(() => parseListItems(prompt), [prompt]);
	const validTaskCount = useMemo(
		() => taskPrompts.filter((p) => p.trim()).length,
		[taskPrompts],
	);

	// Reset state when dialog closes
	useEffect(() => {
		if (!open) {
			setMode("single");
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

	const handleCreateAll = useCallback(() => {
		const validPrompts = getValidPrompts();
		if (validPrompts.length === 0) {
			return;
		}
		onCreateMultiple(validPrompts);
	}, [getValidPrompts, onCreateMultiple]);

	const handleCreateAndStartAll = useCallback(() => {
		const validPrompts = getValidPrompts();
		if (validPrompts.length === 0) {
			return;
		}
		onCreateAndStartMultiple?.(validPrompts);
	}, [getValidPrompts, onCreateAndStartMultiple]);

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
				onCreateAndStart?.();
				return;
			}
			onCreate();
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
		[open, mode, onCreate, onCreateAndStart, handleCreateAll, handleCreateAndStartAll],
	);

	const dialogTitle = mode === "multi"
		? `New tasks${validTaskCount > 0 ? ` (${validTaskCount})` : ""}`
		: "New task";

	const taskCountLabel = validTaskCount === 1 ? "task" : "tasks";

	return (
		<Dialog open={open} onOpenChange={onOpenChange} contentClassName="max-w-2xl">
			<DialogHeader title={dialogTitle} icon={<PencilLine size={16} />} />
			<DialogBody>
				{mode === "single" ? (
					<div>
						<TaskPromptComposer
							value={prompt}
							onValueChange={onPromptChange}
							onSubmit={onCreate}
							onSubmitAndStart={onCreateAndStart}
							placeholder="Describe the task..."
							autoFocus
							workspaceId={workspaceId}
						/>
						<div className="flex items-center justify-between mt-1.5">
							<p className="text-[11px] text-text-tertiary">
								Use <code className="rounded bg-surface-3 px-1 py-px font-mono text-[11px]">@file</code> to reference files.
							</p>
							<button
								type="button"
								onClick={handleSplitIntoTasks}
								className={`inline-flex items-center gap-1.5 text-[12px] text-status-blue hover:text-[#86BEFF] cursor-pointer shrink-0 ${detectedItems.length >= 2 ? "" : "invisible"}`}
							>
								<List size={12} />
								Split into {detectedItems.length || 0} tasks
							</button>
						</div>
					</div>
				) : (
					<div>
						<div className="flex flex-col gap-1.5">
							{taskPrompts.map((taskPrompt, index) => (
								<div
									key={index}
									className="flex items-center gap-1.5"
								>
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
							className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent disabled:opacity-40"
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

					<TaskAgentSelect
						id={agentSelectId}
						value={agentId}
						options={agentOptions}
						onChange={onAgentIdChange}
					/>

					<div className="flex items-center gap-2 flex-wrap">
						<label
							htmlFor={autoReviewEnabledId}
							className="flex items-center gap-2 text-[12px] text-text-primary cursor-pointer select-none"
						>
							<RadixCheckbox.Root
								id={autoReviewEnabledId}
								checked={autoReviewEnabled}
								onCheckedChange={(checked) => onAutoReviewEnabledChange(checked === true)}
								className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
							>
								<RadixCheckbox.Indicator>
									<Check size={10} className="text-white" />
								</RadixCheckbox.Indicator>
							</RadixCheckbox.Root>
							Automatically
						</label>
						<div className="relative inline-flex">
							<select
								value={autoReviewMode}
								onChange={(e) => onAutoReviewModeChange(e.currentTarget.value as TaskAutoReviewMode)}
								className="h-7 appearance-none rounded-md border border-border-bright bg-surface-2 pl-2 pr-7 text-[12px] text-text-primary cursor-pointer focus:border-border-focus focus:outline-none"
								style={{ width: "16ch", maxWidth: "100%" }}
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
			</DialogBody>
			<DialogFooter>
				{mode === "single" ? (
					<>
						<Button variant="default" size="sm" onClick={() => onOpenChange(false)} className="mr-auto">
							Cancel (esc)
						</Button>
						<Button
							size="sm"
							onClick={onCreate}
							disabled={!prompt.trim() || !branchRef}
						>
							<span className="inline-flex items-center">
								Create
								<ButtonShortcut />
							</span>
						</Button>
						{onCreateAndStart ? (
							<Button
								variant="primary"
								size="sm"
								onClick={onCreateAndStart}
								disabled={!prompt.trim() || !branchRef}
							>
								<span className="inline-flex items-center">
									Start
									<ButtonShortcut includeShift />
								</span>
							</Button>
						) : null}
					</>
				) : (
					<>
						<Button variant="default" size="sm" onClick={() => onOpenChange(false)} className="mr-auto">
							Cancel (esc)
						</Button>
						<Button
							size="sm"
							onClick={handleCreateAll}
							disabled={validTaskCount === 0 || !branchRef}
						>
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
