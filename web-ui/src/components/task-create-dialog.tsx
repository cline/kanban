import * as RadixCheckbox from "@radix-ui/react-checkbox";
import {
	ArrowBigUp,
	ArrowLeft,
	Check,
	ChevronDown,
	Command,
	CornerDownLeft,
	FileText,
	List,
	Loader2,
	PencilLine,
	Plus,
	X,
} from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import type { BranchSelectOption } from "@/components/branch-select-dropdown";
import { BranchSelectDropdown } from "@/components/branch-select-dropdown";
import { TaskPromptComposer } from "@/components/task-prompt-composer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeAgentId, RuntimeWorkspaceFileSearchMatch } from "@/runtime/types";
import type { TaskAutoReviewMode } from "@/types";
import { useDebouncedEffect } from "@/utils/react-use";
import { isImportableMarkdownPath, parseMarkdownTaskPrompts, parseTaskListItems } from "@/utils/task-prompt";

const AUTO_REVIEW_MODE_OPTIONS: Array<{ value: TaskAutoReviewMode; label: string }> = [
	{ value: "commit", label: "Make commit" },
	{ value: "pr", label: "Make PR" },
	{ value: "move_to_trash", label: "Move to Trash" },
];

const MARKDOWN_IMPORT_QUERY_DEBOUNCE_MS = 120;
const MARKDOWN_IMPORT_RESULT_LIMIT = 20;

type MultiModeOrigin = "prompt_split" | "markdown_import" | null;

function ButtonShortcut({ includeShift = false }: { includeShift?: boolean }): ReactElement {
	return (
		<span className="inline-flex items-center gap-0.5 ml-1.5" aria-hidden>
			<Command size={12} />
			{includeShift ? <ArrowBigUp size={12} /> : null}
			<CornerDownLeft size={12} />
		</span>
	);
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim()) {
		return error.message;
	}
	return "Unable to import markdown file.";
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
	agentOptions: Array<{ value: RuntimeAgentId; label: string; installed: boolean }>;
	onAgentIdChange: (value: RuntimeAgentId) => void;
	startInPlanModeDisabled?: boolean;
	workspaceId: string | null;
	branchRef: string;
	branchOptions: BranchSelectOption[];
	onBranchRefChange: (value: string) => void;
}): ReactElement {
	const [mode, setMode] = useState<"single" | "multi">("single");
	const [multiModeOrigin, setMultiModeOrigin] = useState<MultiModeOrigin>(null);
	const [taskPrompts, setTaskPrompts] = useState<string[]>([]);
	const [singleModePromptSnapshot, setSingleModePromptSnapshot] = useState("");
	const [isMarkdownImportOpen, setIsMarkdownImportOpen] = useState(false);
	const [markdownImportQuery, setMarkdownImportQuery] = useState("");
	const [markdownImportResults, setMarkdownImportResults] = useState<RuntimeWorkspaceFileSearchMatch[]>([]);
	const [isMarkdownImportSearching, setIsMarkdownImportSearching] = useState(false);
	const [isMarkdownImportLoading, setIsMarkdownImportLoading] = useState(false);
	const [markdownImportSearchError, setMarkdownImportSearchError] = useState<string | null>(null);
	const [markdownImportError, setMarkdownImportError] = useState<string | null>(null);
	const [importedMarkdownPath, setImportedMarkdownPath] = useState<string | null>(null);
	const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
	const nextFocusIndexRef = useRef<number | null>(null);
	const markdownImportSearchRequestIdRef = useRef(0);
	const markdownImportLoadRequestIdRef = useRef(0);
	const startInPlanModeId = useId();
	const autoReviewEnabledId = useId();

	const detectedItems = useMemo(() => parseTaskListItems(prompt), [prompt]);
	const validTaskCount = useMemo(
		() => taskPrompts.filter((value) => value.trim()).length,
		[taskPrompts],
	);

	useEffect(() => {
		if (!open) {
			setMode("single");
			setMultiModeOrigin(null);
			setTaskPrompts([]);
			setSingleModePromptSnapshot("");
			setIsMarkdownImportOpen(false);
			setMarkdownImportQuery("");
			setMarkdownImportResults([]);
			setIsMarkdownImportSearching(false);
			setIsMarkdownImportLoading(false);
			setMarkdownImportSearchError(null);
			setMarkdownImportError(null);
			setImportedMarkdownPath(null);
			inputRefs.current = [];
			nextFocusIndexRef.current = null;
			markdownImportSearchRequestIdRef.current += 1;
			markdownImportLoadRequestIdRef.current += 1;
		}
	}, [open]);

	useEffect(() => {
		if (nextFocusIndexRef.current !== null) {
			const idx = nextFocusIndexRef.current;
			nextFocusIndexRef.current = null;
			requestAnimationFrame(() => {
				inputRefs.current[idx]?.focus();
			});
		}
	});

	useEffect(() => {
		if (!isMarkdownImportOpen || !workspaceId || !markdownImportQuery.trim()) {
			markdownImportSearchRequestIdRef.current += 1;
			setMarkdownImportResults([]);
			setIsMarkdownImportSearching(false);
			setMarkdownImportSearchError(null);
		}
	}, [isMarkdownImportOpen, markdownImportQuery, workspaceId]);

	useDebouncedEffect(
		() => {
			const trimmedQuery = markdownImportQuery.trim();
			if (!isMarkdownImportOpen || !workspaceId || !trimmedQuery) {
				return;
			}
			const requestId = markdownImportSearchRequestIdRef.current + 1;
			markdownImportSearchRequestIdRef.current = requestId;
			setIsMarkdownImportSearching(true);
			setMarkdownImportSearchError(null);
			void (async () => {
				try {
					const trpcClient = getRuntimeTrpcClient(workspaceId);
					const payload = await trpcClient.workspace.searchFiles.query({
						query: trimmedQuery,
						limit: MARKDOWN_IMPORT_RESULT_LIMIT,
					});
					if (requestId !== markdownImportSearchRequestIdRef.current) {
						return;
					}
					setMarkdownImportResults(payload.files.filter((file) => isImportableMarkdownPath(file.path)));
				} catch (error) {
					if (requestId === markdownImportSearchRequestIdRef.current) {
						setMarkdownImportResults([]);
						setMarkdownImportSearchError(getErrorMessage(error));
					}
				} finally {
					if (requestId === markdownImportSearchRequestIdRef.current) {
						setIsMarkdownImportSearching(false);
					}
				}
			})();
		},
		MARKDOWN_IMPORT_QUERY_DEBOUNCE_MS,
		[isMarkdownImportOpen, markdownImportQuery, workspaceId],
	);

	const handleSplitIntoTasks = useCallback(() => {
		setMarkdownImportError(null);
		setImportedMarkdownPath(null);
		setIsMarkdownImportOpen(false);
		setMarkdownImportQuery("");
		setMarkdownImportResults([]);
		setIsMarkdownImportSearching(false);
		setMarkdownImportSearchError(null);
		markdownImportSearchRequestIdRef.current += 1;
		markdownImportLoadRequestIdRef.current += 1;
		setTaskPrompts(detectedItems);
		setMultiModeOrigin("prompt_split");
		setMode("multi");
		nextFocusIndexRef.current = 0;
	}, [detectedItems]);

	const handleCloseMarkdownImport = useCallback(() => {
		markdownImportSearchRequestIdRef.current += 1;
		markdownImportLoadRequestIdRef.current += 1;
		setIsMarkdownImportOpen(false);
		setMarkdownImportQuery("");
		setMarkdownImportResults([]);
		setIsMarkdownImportSearching(false);
		setIsMarkdownImportLoading(false);
		setMarkdownImportSearchError(null);
		setMarkdownImportError(null);
	}, []);

	const handleOpenMarkdownImport = useCallback(() => {
		setMarkdownImportError(null);
		setMarkdownImportSearchError(null);
		setMarkdownImportQuery("");
		setMarkdownImportResults([]);
		setIsMarkdownImportSearching(false);
		setIsMarkdownImportOpen(true);
	}, []);

	const handleImportMarkdownFile = useCallback(
		async (filePath: string) => {
			if (!workspaceId) {
				setMarkdownImportError("Select a workspace before importing markdown.");
				return;
			}
			const requestId = markdownImportLoadRequestIdRef.current + 1;
			markdownImportLoadRequestIdRef.current = requestId;
			setIsMarkdownImportLoading(true);
			setMarkdownImportSearchError(null);
			setMarkdownImportError(null);
			try {
				const trpcClient = getRuntimeTrpcClient(workspaceId);
				const payload = await trpcClient.workspace.readFile.query({ path: filePath });
				if (requestId !== markdownImportLoadRequestIdRef.current) {
					return;
				}
				const parsedPrompts = parseMarkdownTaskPrompts(payload.content, { sourcePath: payload.path });
				if (parsedPrompts.length === 0) {
					setMarkdownImportError(
						"No importable tasks found. Use unchecked checklist items or top-level lists under Plan/Tasks/Phase sections.",
					);
					return;
				}
				markdownImportSearchRequestIdRef.current += 1;
				setSingleModePromptSnapshot(prompt);
				setTaskPrompts(parsedPrompts);
				setMultiModeOrigin("markdown_import");
				setImportedMarkdownPath(payload.path);
				setIsMarkdownImportOpen(false);
				setMarkdownImportQuery("");
				setMarkdownImportResults([]);
				setIsMarkdownImportSearching(false);
				setMarkdownImportSearchError(null);
				setMarkdownImportError(null);
				setMode("multi");
				nextFocusIndexRef.current = 0;
			} catch (error) {
				if (requestId === markdownImportLoadRequestIdRef.current) {
					setMarkdownImportError(getErrorMessage(error));
				}
			} finally {
				if (requestId === markdownImportLoadRequestIdRef.current) {
					setIsMarkdownImportLoading(false);
				}
			}
		},
		[prompt, workspaceId],
	);

	const handleBackToSingle = useCallback(() => {
		if (multiModeOrigin === "markdown_import") {
			onPromptChange(singleModePromptSnapshot);
			setMode("single");
			setMultiModeOrigin(null);
			setTaskPrompts([]);
			setSingleModePromptSnapshot("");
			setImportedMarkdownPath(null);
			setMarkdownImportSearchError(null);
			setMarkdownImportError(null);
			return;
		}
		const joined = taskPrompts
			.filter((value) => value.trim())
			.map((value, index) => `${index + 1}. ${value}`)
			.join("\n");
		onPromptChange(joined);
		setMode("single");
		setMultiModeOrigin(null);
		setTaskPrompts([]);
		setImportedMarkdownPath(null);
	}, [multiModeOrigin, onPromptChange, singleModePromptSnapshot, taskPrompts]);

	const handleUpdateTaskPrompt = useCallback((index: number, value: string) => {
		setTaskPrompts((current) => {
			const next = [...current];
			next[index] = value;
			return next;
		});
	}, []);

	const handleRemoveTask = useCallback((index: number) => {
		setTaskPrompts((current) => {
			if (current.length <= 1) {
				return current;
			}
			nextFocusIndexRef.current = Math.min(index, current.length - 2);
			return current.filter((_, currentIndex) => currentIndex !== index);
		});
	}, []);

	const handleAddTask = useCallback((afterIndex?: number) => {
		setTaskPrompts((current) => {
			const insertIndex = afterIndex !== undefined ? afterIndex + 1 : current.length;
			nextFocusIndexRef.current = insertIndex;
			const next = [...current];
			next.splice(insertIndex, 0, "");
			return next;
		});
	}, []);

	const getValidPrompts = useCallback(() => {
		return taskPrompts.filter((value) => value.trim());
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

	const setInputRef = useCallback((index: number, element: HTMLInputElement | null) => {
		inputRefs.current[index] = element;
	}, []);

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
			enabled: open && !isMarkdownImportOpen,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			ignoreEventWhen: (event) => {
				if (!event.defaultPrevented) return false;
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
	const showSplitAction = detectedItems.length >= 2;
	const canImportMarkdown = workspaceId !== null;
	const isAgentSelectDisabled = agentOptions.length === 0;
	const showNoMarkdownResults =
		isMarkdownImportOpen &&
		markdownImportQuery.trim().length > 0 &&
		!isMarkdownImportSearching &&
		!markdownImportSearchError &&
		markdownImportResults.length === 0;

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
						<div className="mt-1.5 flex items-start justify-between gap-3">
							<p className="text-[11px] text-text-tertiary">
								Use <code className="rounded bg-surface-3 px-1 py-px font-mono text-[11px]">@file</code> to reference files.
							</p>
							<div className="flex items-center gap-3 shrink-0">
								<button
									type="button"
									onClick={handleSplitIntoTasks}
									className={`inline-flex items-center gap-1.5 text-[12px] text-status-blue hover:text-[#86BEFF] cursor-pointer ${showSplitAction ? "" : "invisible"}`}
								>
									<List size={12} />
									Split into {detectedItems.length || 0} tasks
								</button>
								<button
									type="button"
									onClick={handleOpenMarkdownImport}
									disabled={!canImportMarkdown || isMarkdownImportLoading}
									className="inline-flex items-center gap-1.5 text-[12px] text-status-blue hover:text-[#86BEFF] disabled:cursor-not-allowed disabled:text-text-tertiary"
								>
									{isMarkdownImportLoading ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
									Import markdown
								</button>
							</div>
						</div>

						{isMarkdownImportOpen ? (
							<div className="mt-3 rounded-lg border border-border bg-surface-1 p-3">
								<div className="flex items-center gap-2">
									<input
										type="text"
										value={markdownImportQuery}
										onChange={(event) => {
											setMarkdownImportQuery(event.target.value);
											setMarkdownImportSearchError(null);
											setMarkdownImportError(null);
										}}
										placeholder="Search PRD / strategy files..."
										autoFocus
										className="flex-1 min-w-0 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
									/>
									<Button
										variant="ghost"
										size="sm"
										icon={<X size={14} />}
										onClick={handleCloseMarkdownImport}
										aria-label="Close markdown import"
									/>
								</div>
								<p className="mt-1 text-[11px] text-text-secondary">
									Search by filename or path. Only .md, .markdown, and .mdx files are importable.
								</p>
								<div className="mt-2 rounded-md border border-border bg-surface-2">
									{isMarkdownImportSearching ? (
										<div className="px-3 py-2 text-[12px] text-text-secondary">Searching markdown files...</div>
									) : markdownImportQuery.trim().length === 0 ? (
										<div className="px-3 py-2 text-[12px] text-text-secondary">Start typing to search the workspace.</div>
									) : markdownImportSearchError ? (
										<div className="px-3 py-2 text-[12px] text-status-red">{markdownImportSearchError}</div>
									) : showNoMarkdownResults ? (
										<div className="px-3 py-2 text-[12px] text-text-secondary">No markdown files matched.</div>
									) : (
										<div className="max-h-48 overflow-y-auto p-1">
											{markdownImportResults.map((file) => (
												<button
													type="button"
													key={file.path}
													onClick={() => {
														void handleImportMarkdownFile(file.path);
													}}
													disabled={isMarkdownImportLoading}
													className="w-full rounded-md px-2 py-2 text-left hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-60"
												>
													<div className="flex items-center gap-2">
														<FileText size={13} className="text-text-secondary shrink-0" />
														<span className="min-w-0 truncate text-[12px] text-text-primary">{file.name}</span>
														{file.changed ? (
															<span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-text-secondary">changed</span>
														) : null}
													</div>
													<div className="mt-1 break-all font-mono text-[11px] text-text-secondary">{file.path}</div>
												</button>
											))}
										</div>
									)}
								</div>
								{markdownImportError ? (
									<div className="mt-2 rounded-md border border-status-red/40 bg-status-red/10 px-3 py-2 text-[12px] text-status-red">
										{markdownImportError}
									</div>
								) : null}
							</div>
						) : null}
					</div>
				) : (
					<div>
						{multiModeOrigin === "markdown_import" && importedMarkdownPath ? (
							<div className="mb-3 rounded-md border border-border bg-surface-1 px-3 py-2 text-[12px] text-text-secondary">
								Imported from <span className="font-mono text-text-primary">{importedMarkdownPath}</span>
							</div>
						) : null}
						<div className="flex flex-col gap-1.5">
							{taskPrompts.map((taskPrompt, index) => (
								<div key={index} className="flex items-center gap-1.5">
									<span className="shrink-0 text-right text-[12px] tabular-nums text-text-tertiary">{index + 1}.</span>
									<input
										ref={(element) => setInputRef(index, element)}
										type="text"
										value={taskPrompt}
										onChange={(event) => handleUpdateTaskPrompt(index, event.target.value)}
										onKeyDown={(event) => handleInputKeyDown(index, event)}
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
						<div className="mt-3 flex items-center justify-between">
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

				<div className="mt-4 flex flex-col gap-2.5 border-t border-border pt-4">
					<label
						htmlFor={startInPlanModeId}
						className="flex cursor-pointer select-none items-center gap-2 text-[12px] text-text-primary"
					>
						<RadixCheckbox.Root
							id={startInPlanModeId}
							checked={startInPlanMode}
							onCheckedChange={(checked) => onStartInPlanModeChange(checked === true)}
							disabled={startInPlanModeDisabled}
							className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-40"
						>
							<RadixCheckbox.Indicator>
								<Check size={10} className="text-white" />
							</RadixCheckbox.Indicator>
						</RadixCheckbox.Root>
						Start in plan mode
					</label>

					<div>
						<span className="mb-1 block text-[11px] text-text-secondary">Agent runtime</span>
						<div className="relative inline-flex max-w-full">
							<select
								value={agentId ?? ""}
								onChange={(event) => {
									const value = event.currentTarget.value;
									if (!value) {
										return;
									}
									onAgentIdChange(value as RuntimeAgentId);
								}}
								disabled={isAgentSelectDisabled}
								className="h-7 w-[22ch] max-w-full appearance-none rounded-md border border-border-bright bg-surface-2 pl-2 pr-7 text-[12px] text-text-primary cursor-pointer focus:border-border-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
							>
								<option value="">
									{agentOptions.length === 0 ? "Loading runtimes..." : "Select runtime"}
								</option>
								{agentOptions.map((option) => (
									<option key={option.value} value={option.value}>
										{option.installed ? option.label : `${option.label} (not installed)`}
									</option>
								))}
							</select>
							<ChevronDown
								size={14}
								className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-text-secondary"
							/>
						</div>
					</div>

					<div>
						<span className="mb-1 block text-[11px] text-text-secondary">Worktree base ref</span>
						<BranchSelectDropdown
							options={branchOptions}
							selectedValue={branchRef}
							onSelect={onBranchRefChange}
							fill
							size="sm"
							emptyText="No branches detected"
						/>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<label
							htmlFor={autoReviewEnabledId}
							className="flex cursor-pointer select-none items-center gap-2 text-[12px] text-text-primary"
						>
							<RadixCheckbox.Root
								id={autoReviewEnabledId}
								checked={autoReviewEnabled}
								onCheckedChange={(checked) => onAutoReviewEnabledChange(checked === true)}
								className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:border-accent data-[state=checked]:bg-accent"
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
								onChange={(event) => onAutoReviewModeChange(event.currentTarget.value as TaskAutoReviewMode)}
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
						<Button size="sm" onClick={onCreate} disabled={!prompt.trim() || !branchRef}>
							<span className="inline-flex items-center">
								Create
								<ButtonShortcut />
							</span>
						</Button>
						{onCreateAndStart ? (
							<Button variant="primary" size="sm" onClick={onCreateAndStart} disabled={!prompt.trim() || !branchRef}>
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
