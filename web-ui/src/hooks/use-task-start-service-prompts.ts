import { useCallback, useEffect, useMemo, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import type { RuntimeAgentId, RuntimeTaskStartSetupAvailability } from "@/runtime/types";
import { findCardSelection } from "@/state/board-state";
import { LocalStorageKey } from "@/storage/local-storage-store";
import type { TaskStartSetupKind } from "@/telemetry/events";
import {
	toTelemetrySelectedAgentId,
	trackTaskStartSetupInstallCommandClicked,
	trackTaskStartSetupPromptViewed,
} from "@/telemetry/events";
import type { SendTerminalInputOptions } from "@/terminal/terminal-input";
import type { BoardData } from "@/types";
import { useBooleanLocalStorageValue } from "@/utils/react-use";

export interface TaskStartServicePromptContent {
	id: TaskStartSetupKind;
	title: string;
	description: string;
	learnMoreUrl?: string;
	installCommand?: string;
	installButtonLabel?: string;
	installCommandDescription?: string;
	authenticationNote?: string;
}

export interface TaskStartServicePromptTask {
	taskId: string;
	prompt: string;
}

export interface CollectedTaskStartServicePrompt {
	promptId: TaskStartSetupKind;
	taskIds: string[];
}

type TaskStartServicePromptPlatform = "mac" | "windows" | "other";

const LINEAR_WORD_PATTERN = /\blinear\b/i;
const GITHUB_WORD_PATTERN = /\bgithub\b/i;
const DEFAULT_LINEAR_INSTALL_COMMAND = "claude mcp add --transport http --scope user linear https://mcp.linear.app/mcp";
const CLINE_CLI_INSTALL_COMMAND = "npm install -g cline";
const SUPPORTED_AGENT_LABELS = "Claude Code, OpenAI Codex, Cline, OpenCode, Droid CLI, or Gemini CLI";

function getLinearMcpInstallCommand(selectedAgentId: RuntimeAgentId | null | undefined): string {
	switch (selectedAgentId) {
		case "codex":
			return "codex mcp add linear --url https://mcp.linear.app/mcp";
		case "gemini":
			return "gemini mcp add linear https://mcp.linear.app/mcp --transport http --scope user";
		case "opencode":
			return "opencode mcp add";
		case "droid":
			return "droid mcp add linear https://mcp.linear.app/mcp --type http";
		case "cline":
			return "cline mcp add linear https://mcp.linear.app/mcp --type http";
		default:
			return DEFAULT_LINEAR_INSTALL_COMMAND;
	}
}

function resolveTaskStartServicePromptPlatform(
	explicitPlatform?: TaskStartServicePromptPlatform,
): TaskStartServicePromptPlatform {
	if (explicitPlatform) {
		return explicitPlatform;
	}
	if (typeof navigator === "undefined") {
		return "other";
	}
	const platformSource = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
	if (platformSource.includes("mac") || platformSource.includes("darwin")) {
		return "mac";
	}
	if (platformSource.includes("win")) {
		return "windows";
	}
	return "other";
}

function getGithubCliInstallCommand(platform: TaskStartServicePromptPlatform): string | null {
	switch (platform) {
		case "mac":
			return "brew install gh";
		case "windows":
			return "winget install --id GitHub.cli";
		default:
			return null;
	}
}

export function getTaskStartServicePromptKey(taskId: string, promptId: TaskStartSetupKind): string {
	// Stable key used to remember a one-time dialog close for this specific task and prompt type.
	return `${taskId}:${promptId}`;
}

export function detectTaskStartServicePromptIds(prompt: string): TaskStartSetupKind[] {
	const normalizedPrompt = prompt.trim();
	if (!normalizedPrompt) {
		return [];
	}

	const results: TaskStartSetupKind[] = [];

	if (LINEAR_WORD_PATTERN.test(normalizedPrompt)) {
		results.push("linear_mcp");
	}

	if (GITHUB_WORD_PATTERN.test(normalizedPrompt)) {
		results.push("github_cli");
	}

	return results;
}

export function isTaskStartServicePromptAlreadyConfigured(
	promptId: TaskStartSetupKind,
	taskStartSetupAvailability: RuntimeTaskStartSetupAvailability | null | undefined,
	options?: {
		hasInstalledAgent?: boolean | null;
	},
): boolean {
	if (!taskStartSetupAvailability) {
		if (promptId === "agent_cli") {
			return options?.hasInstalledAgent === true;
		}
		return false;
	}

	switch (promptId) {
		case "linear_mcp":
			return taskStartSetupAvailability.linearMcp;
		case "github_cli":
			return taskStartSetupAvailability.githubCli;
		case "agent_cli":
			return options?.hasInstalledAgent === true;
		default:
			return false;
	}
}

export function buildTaskStartServicePromptContent(
	promptId: TaskStartSetupKind,
	options?: { selectedAgentId?: RuntimeAgentId | null; platform?: TaskStartServicePromptPlatform },
): TaskStartServicePromptContent {
	switch (promptId) {
		case "linear_mcp": {
			const installCommand = getLinearMcpInstallCommand(options?.selectedAgentId ?? null);
			const isOpenCode = options?.selectedAgentId === "opencode";
			return {
				id: promptId,
				title: "Set up Linear MCP before starting this task?",
				description: isOpenCode
					? "This task looks like it references Linear. In OpenCode, run the command below, then use name: linear, server URL: https://mcp.linear.app/mcp, and complete OAuth authentication if prompted."
					: "This task looks like it references Linear. Connecting the Linear MCP gives the agent direct issue context while it works.",
				learnMoreUrl: "https://linear.app/docs/mcp",
				installCommand,
				installButtonLabel: "Run install command",
				installCommandDescription: isOpenCode
					? "Run this first, then follow OpenCode prompts:"
					: "Install command:",
				authenticationNote: isOpenCode
					? "After installing, run OpenCode and use /mcp to complete authentication."
					: "After installing, run your agent and use /mcp to complete authentication.",
			};
		}
		case "github_cli": {
			const platform = resolveTaskStartServicePromptPlatform(options?.platform);
			const installCommand = getGithubCliInstallCommand(platform);
			return {
				id: promptId,
				title: "Set up GitHub CLI before starting this task?",
				description:
					"This task includes a GitHub link. Setting up gh CLI helps the agent inspect issues and pull requests with native GitHub commands.",
				learnMoreUrl: "https://cli.github.com/",
				...(installCommand
					? {
							installCommand,
							installButtonLabel: "Run install command",
							installCommandDescription: "Install command:",
						}
					: {}),
			};
		}
		case "agent_cli": {
			return {
				id: promptId,
				title: "Set up a CLI agent before starting this task?",
				description: `No supported CLI agent was detected on your PATH. Kanban can run tasks with ${SUPPORTED_AGENT_LABELS}.`,
				installCommand: CLINE_CLI_INSTALL_COMMAND,
				installButtonLabel: "Run install command",
				installCommandDescription: "Install Cline CLI:",
				authenticationNote: "After installing, try starting the task again.",
			};
		}
		default:
			return {
				id: promptId,
				title: "Setup recommendation",
				description: "This task references an external service that can be configured for better context.",
			};
	}
}

export function collectPendingTaskStartServicePrompts(input: {
	tasks: TaskStartServicePromptTask[];
	taskStartSetupAvailability: RuntimeTaskStartSetupAvailability | null | undefined;
	hasInstalledAgent?: boolean | null;
	promptAcknowledgements: Record<string, true>;
	isPromptDoNotShowAgainEnabled: (promptId: TaskStartSetupKind) => boolean;
}): CollectedTaskStartServicePrompt[] {
	if (input.hasInstalledAgent === false && !input.isPromptDoNotShowAgainEnabled("agent_cli")) {
		const missingAgentPromptTaskIds = [...new Set(input.tasks.map((task) => task.taskId))].filter((taskId) => {
			const promptKey = getTaskStartServicePromptKey(taskId, "agent_cli");
			return !input.promptAcknowledgements[promptKey];
		});
		if (missingAgentPromptTaskIds.length > 0) {
			return [
				{
					promptId: "agent_cli",
					taskIds: missingAgentPromptTaskIds,
				},
			];
		}
	}

	const promptTaskIdsByPromptId = new Map<TaskStartSetupKind, string[]>();

	for (const task of input.tasks) {
		for (const promptId of detectTaskStartServicePromptIds(task.prompt)) {
			if (isTaskStartServicePromptAlreadyConfigured(promptId, input.taskStartSetupAvailability)) {
				continue;
			}

			if (input.isPromptDoNotShowAgainEnabled(promptId)) {
				continue;
			}

			const promptKey = getTaskStartServicePromptKey(task.taskId, promptId);
			if (input.promptAcknowledgements[promptKey]) {
				continue;
			}

			const taskIds = promptTaskIdsByPromptId.get(promptId);
			if (taskIds) {
				taskIds.push(task.taskId);
				continue;
			}
			promptTaskIdsByPromptId.set(promptId, [task.taskId]);
		}
	}

	return Array.from(promptTaskIdsByPromptId, ([promptId, taskIds]) => ({
		promptId,
		taskIds,
	}));
}

export function mergeTaskStartServicePromptQueue(
	currentQueue: CollectedTaskStartServicePrompt[],
	nextQueue: CollectedTaskStartServicePrompt[],
): CollectedTaskStartServicePrompt[] {
	if (currentQueue.length === 0) {
		return nextQueue;
	}

	const mergedQueue = [...currentQueue];
	for (const prompt of nextQueue) {
		const existingPromptIndex = mergedQueue.findIndex((queued) => queued.promptId === prompt.promptId);
		if (existingPromptIndex === -1) {
			mergedQueue.push(prompt);
			continue;
		}
		const existingPrompt = mergedQueue[existingPromptIndex];
		if (!existingPrompt) {
			continue;
		}
		mergedQueue[existingPromptIndex] = {
			...existingPrompt,
			taskIds: [...new Set([...existingPrompt.taskIds, ...prompt.taskIds])],
		};
	}

	return mergedQueue;
}

interface PendingTaskStartServicePromptState {
	promptId: TaskStartSetupKind;
	taskIds: string[];
}

interface PrepareTerminalForShortcutResult {
	ok: boolean;
	targetTaskId?: string;
	message?: string;
}

interface UseTaskStartServicePromptsInput {
	board: BoardData;
	currentProjectId: string | null;
	selectedAgentId: RuntimeAgentId | null | undefined;
	taskStartSetupAvailability: RuntimeTaskStartSetupAvailability | null | undefined;
	hasInstalledAgent: boolean | null | undefined;
	handleCreateTask: () => string | null;
	handleCreateTasks: (prompts: string[]) => string[];
	handleStartTask: (taskId: string) => void;
	handleStartAllBacklogTasks: (taskIds?: string[]) => void;
	prepareTerminalForShortcut: (input: {
		prepareWaitForTerminalConnectionReady: (taskId: string) => () => Promise<void>;
	}) => Promise<PrepareTerminalForShortcutResult>;
	prepareWaitForTerminalConnectionReady: (taskId: string) => () => Promise<void>;
	sendTaskSessionInput: (
		taskId: string,
		text: string,
		options?: SendTerminalInputOptions,
	) => Promise<{ ok: boolean; message?: string }>;
}

export interface UseTaskStartServicePromptsResult {
	handleCreateAndStartTask: () => void;
	handleCreateAndStartTasks: (prompts: string[]) => void;
	handleStartTaskWithServiceSetupPrompt: (taskId: string) => void;
	handleStartAllBacklogTasksWithServiceSetupPrompt: () => void;
	taskStartServicePromptDialogOpen: boolean;
	taskStartServicePromptDialogPrompt: TaskStartServicePromptContent | null;
	taskStartServicePromptDoNotShowAgain: boolean;
	setTaskStartServicePromptDoNotShowAgain: (value: boolean) => void;
	handleCloseTaskStartServicePrompt: () => void;
	handleRunTaskStartServiceInstallCommand: (() => void) | undefined;
}

export function useTaskStartServicePrompts({
	board,
	currentProjectId,
	selectedAgentId,
	taskStartSetupAvailability,
	hasInstalledAgent,
	handleCreateTask,
	handleCreateTasks,
	handleStartTask,
	handleStartAllBacklogTasks,
	prepareTerminalForShortcut,
	prepareWaitForTerminalConnectionReady,
	sendTaskSessionInput,
}: UseTaskStartServicePromptsInput): UseTaskStartServicePromptsResult {
	const [isLinearTaskStartPromptDoNotShowAgain, setIsLinearTaskStartPromptDoNotShowAgain] =
		useBooleanLocalStorageValue(LocalStorageKey.TaskStartLinearSetupPromptDoNotShowAgain, false);
	const [isGithubTaskStartPromptDoNotShowAgain, setIsGithubTaskStartPromptDoNotShowAgain] =
		useBooleanLocalStorageValue(LocalStorageKey.TaskStartGithubSetupPromptDoNotShowAgain, false);
	const [isAgentCliTaskStartPromptDoNotShowAgain, setIsAgentCliTaskStartPromptDoNotShowAgain] =
		useBooleanLocalStorageValue(LocalStorageKey.TaskStartAgentCliSetupPromptDoNotShowAgain, false);
	const [pendingTaskStartServicePromptQueue, setPendingTaskStartServicePromptQueue] = useState<
		PendingTaskStartServicePromptState[]
	>([]);
	const [pendingTaskStartAfterCreateIds, setPendingTaskStartAfterCreateIds] = useState<string[] | null>(null);
	const [taskStartServicePromptDoNotShowAgain, setTaskStartServicePromptDoNotShowAgain] = useState(false);
	const [taskStartServicePromptAcknowledgements, setTaskStartServicePromptAcknowledgements] = useState<
		Record<string, true>
	>({});

	useEffect(() => {
		setPendingTaskStartServicePromptQueue([]);
		setPendingTaskStartAfterCreateIds(null);
		setTaskStartServicePromptDoNotShowAgain(false);
		setTaskStartServicePromptAcknowledgements({});
	}, [currentProjectId]);

	useEffect(() => {
		const activePendingPrompt = pendingTaskStartServicePromptQueue[0] ?? null;
		if (!activePendingPrompt) {
			return;
		}
		const hasBacklogTask = activePendingPrompt.taskIds.some((taskId) => {
			const selection = findCardSelection(board, taskId);
			return selection?.column.id === "backlog";
		});
		if (hasBacklogTask) {
			return;
		}
		setPendingTaskStartServicePromptQueue([]);
		setTaskStartServicePromptDoNotShowAgain(false);
	}, [board, pendingTaskStartServicePromptQueue]);

	const isTaskStartServicePromptDoNotShowAgainEnabled = useCallback(
		(promptId: TaskStartSetupKind): boolean => {
			switch (promptId) {
				case "linear_mcp":
					return isLinearTaskStartPromptDoNotShowAgain;
				case "github_cli":
					return isGithubTaskStartPromptDoNotShowAgain;
				case "agent_cli":
					return isAgentCliTaskStartPromptDoNotShowAgain;
				default:
					return false;
			}
		},
		[
			isAgentCliTaskStartPromptDoNotShowAgain,
			isGithubTaskStartPromptDoNotShowAgain,
			isLinearTaskStartPromptDoNotShowAgain,
		],
	);

	const setTaskStartServicePromptDoNotShowAgainPreference = useCallback(
		(promptId: TaskStartSetupKind, value: boolean) => {
			switch (promptId) {
				case "linear_mcp":
					setIsLinearTaskStartPromptDoNotShowAgain(value);
					return;
				case "github_cli":
					setIsGithubTaskStartPromptDoNotShowAgain(value);
					return;
				case "agent_cli":
					setIsAgentCliTaskStartPromptDoNotShowAgain(value);
					return;
				default:
					return;
			}
		},
		[
			setIsAgentCliTaskStartPromptDoNotShowAgain,
			setIsGithubTaskStartPromptDoNotShowAgain,
			setIsLinearTaskStartPromptDoNotShowAgain,
		],
	);

	const acknowledgeTaskStartServicePrompt = useCallback(
		(
			pendingPrompt: PendingTaskStartServicePromptState,
			options?: {
				suppressFuturePrompts?: boolean;
			},
		) => {
			setTaskStartServicePromptAcknowledgements((current) => {
				let next = current;
				for (const taskId of pendingPrompt.taskIds) {
					const promptKey = getTaskStartServicePromptKey(taskId, pendingPrompt.promptId);
					if (next[promptKey]) {
						continue;
					}
					if (next === current) {
						next = { ...current };
					}
					next[promptKey] = true;
				}
				return next;
			});
			if (options?.suppressFuturePrompts) {
				setTaskStartServicePromptDoNotShowAgainPreference(pendingPrompt.promptId, true);
			}
		},
		[setTaskStartServicePromptDoNotShowAgainPreference],
	);

	const runTaskStartServiceInstallCommand = useCallback(
		async (command: string): Promise<void> => {
			if (!currentProjectId) {
				showAppToast(
					{
						intent: "danger",
						icon: "warning-sign",
						message: "Could not run setup command because no project is selected.",
						timeout: 5000,
					},
					"task-start-service-setup-no-project",
				);
				return;
			}

			try {
				const prepared = await prepareTerminalForShortcut({
					prepareWaitForTerminalConnectionReady,
				});
				if (!prepared.ok || !prepared.targetTaskId) {
					throw new Error(prepared.message ?? "Could not open terminal.");
				}

				const sent = await sendTaskSessionInput(prepared.targetTaskId, command, {
					appendNewline: true,
				});
				if (!sent.ok) {
					throw new Error(sent.message ?? "Could not run setup command.");
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast(
					{
						intent: "danger",
						icon: "warning-sign",
						message: `Could not run setup command: ${message}`,
						timeout: 7000,
					},
					"task-start-service-setup-command-failed",
				);
			}
		},
		[currentProjectId, prepareTerminalForShortcut, prepareWaitForTerminalConnectionReady, sendTaskSessionInput],
	);

	const activePendingTaskStartServicePrompt = pendingTaskStartServicePromptQueue[0] ?? null;

	useEffect(() => {
		if (!activePendingTaskStartServicePrompt) {
			return;
		}
		trackTaskStartSetupPromptViewed({
			setup_kind: activePendingTaskStartServicePrompt.promptId,
			selected_agent_id: toTelemetrySelectedAgentId(selectedAgentId),
		});
	}, [activePendingTaskStartServicePrompt?.promptId, activePendingTaskStartServicePrompt?.taskIds, selectedAgentId]);

	const taskStartServicePromptDialogPrompt = useMemo(() => {
		if (!activePendingTaskStartServicePrompt) {
			return null;
		}
		return buildTaskStartServicePromptContent(activePendingTaskStartServicePrompt.promptId, {
			selectedAgentId,
		});
	}, [activePendingTaskStartServicePrompt, selectedAgentId]);

	const handleCloseTaskStartServicePrompt = useCallback(() => {
		if (!activePendingTaskStartServicePrompt) {
			return;
		}

		acknowledgeTaskStartServicePrompt(activePendingTaskStartServicePrompt, {
			suppressFuturePrompts: taskStartServicePromptDoNotShowAgain,
		});
		setPendingTaskStartServicePromptQueue((currentQueue) => currentQueue.slice(1));
		setTaskStartServicePromptDoNotShowAgain(false);
	}, [acknowledgeTaskStartServicePrompt, activePendingTaskStartServicePrompt, taskStartServicePromptDoNotShowAgain]);

	const handleRunTaskStartServiceInstallCommand = useCallback(() => {
		if (!activePendingTaskStartServicePrompt) {
			return;
		}

		const installCommand = taskStartServicePromptDialogPrompt?.installCommand?.trim();
		trackTaskStartSetupInstallCommandClicked({
			setup_kind: activePendingTaskStartServicePrompt.promptId,
			selected_agent_id: toTelemetrySelectedAgentId(selectedAgentId),
		});
		acknowledgeTaskStartServicePrompt(activePendingTaskStartServicePrompt, {
			suppressFuturePrompts: taskStartServicePromptDoNotShowAgain,
		});
		setPendingTaskStartServicePromptQueue((currentQueue) => currentQueue.slice(1));
		setTaskStartServicePromptDoNotShowAgain(false);
		if (!installCommand) {
			return;
		}
		void runTaskStartServiceInstallCommand(installCommand);
	}, [
		acknowledgeTaskStartServicePrompt,
		activePendingTaskStartServicePrompt,
		runTaskStartServiceInstallCommand,
		selectedAgentId,
		taskStartServicePromptDialogPrompt?.installCommand,
		taskStartServicePromptDoNotShowAgain,
	]);

	const clearTaskStartServicePromptAcknowledgements = useCallback(
		(taskIds: string[]) => {
			setTaskStartServicePromptAcknowledgements((current) => {
				let next = current;
				for (const taskId of taskIds) {
					const selection = findCardSelection(board, taskId);
					if (!selection) {
						continue;
					}
					const promptIds = detectTaskStartServicePromptIds(selection.card.prompt);
					if (hasInstalledAgent === false) {
						promptIds.push("agent_cli");
					}
					for (const promptId of promptIds) {
						const promptKey = getTaskStartServicePromptKey(taskId, promptId);
						if (!(promptKey in next)) {
							continue;
						}
						if (next === current) {
							next = { ...current };
						}
						delete next[promptKey];
					}
				}
				return next;
			});
		},
		[board, hasInstalledAgent],
	);

	const queueTaskStartServicePrompts = useCallback(
		(taskIds: string[]): boolean => {
			const queuedPrompts = collectPendingTaskStartServicePrompts({
				tasks: [...new Set(taskIds.filter((taskId) => taskId.trim().length > 0))]
					.map((taskId) => {
						const selection = findCardSelection(board, taskId);
						if (!selection || selection.column.id !== "backlog") {
							return null;
						}
						return {
							taskId,
							prompt: selection.card.prompt,
						};
					})
					.filter((task): task is TaskStartServicePromptTask => task !== null),
				taskStartSetupAvailability,
				hasInstalledAgent,
				promptAcknowledgements: taskStartServicePromptAcknowledgements,
				isPromptDoNotShowAgainEnabled: isTaskStartServicePromptDoNotShowAgainEnabled,
			});

			if (queuedPrompts.length === 0) {
				return false;
			}

			setTaskStartServicePromptDoNotShowAgain(false);
			setPendingTaskStartServicePromptQueue((currentQueue) => mergeTaskStartServicePromptQueue(currentQueue, queuedPrompts));
			return true;
		},
		[
			board,
			hasInstalledAgent,
			isTaskStartServicePromptDoNotShowAgainEnabled,
			taskStartSetupAvailability,
			taskStartServicePromptAcknowledgements,
		],
	);

	const startTasksWithServiceSetupPrompt = useCallback(
		(taskIds: string[]) => {
			const backlogTaskIds = [...new Set(taskIds.filter((taskId) => taskId.trim().length > 0))].filter((taskId) => {
				const selection = findCardSelection(board, taskId);
				return selection?.column.id === "backlog";
			});

			if (backlogTaskIds.length === 0) {
				return;
			}

			if (queueTaskStartServicePrompts(backlogTaskIds)) {
				return;
			}

			clearTaskStartServicePromptAcknowledgements(backlogTaskIds);
			if (backlogTaskIds.length === 1) {
				const firstTaskId = backlogTaskIds[0];
				if (!firstTaskId) {
					return;
				}
				handleStartTask(firstTaskId);
				return;
			}
			handleStartAllBacklogTasks(backlogTaskIds);
		},
		[
			board,
			clearTaskStartServicePromptAcknowledgements,
			handleStartAllBacklogTasks,
			handleStartTask,
			queueTaskStartServicePrompts,
		],
	);

	const handleStartTaskWithServiceSetupPrompt = useCallback(
		(taskId: string) => {
			const selection = findCardSelection(board, taskId);
			if (!selection || selection.column.id !== "backlog") {
				handleStartTask(taskId);
				return;
			}
			startTasksWithServiceSetupPrompt([taskId]);
		},
		[board, handleStartTask, startTasksWithServiceSetupPrompt],
	);

	const handleStartAllBacklogTasksWithServiceSetupPrompt = useCallback(() => {
		const backlogTaskIds =
			board.columns.find((column) => column.id === "backlog")?.cards.map((card) => card.id) ?? [];
		if (backlogTaskIds.length === 0) {
			return;
		}
		startTasksWithServiceSetupPrompt(backlogTaskIds);
	}, [board.columns, startTasksWithServiceSetupPrompt]);

	const handleCreateAndStartTask = useCallback(() => {
		const taskId = handleCreateTask();
		if (!taskId) {
			return;
		}
		setPendingTaskStartAfterCreateIds([taskId]);
	}, [handleCreateTask]);

	const handleCreateAndStartTasks = useCallback(
		(prompts: string[]) => {
			const taskIds = handleCreateTasks(prompts);
			if (taskIds.length === 0) {
				return;
			}
			setPendingTaskStartAfterCreateIds(taskIds);
		},
		[handleCreateTasks],
	);

	useEffect(() => {
		if (!pendingTaskStartAfterCreateIds || pendingTaskStartAfterCreateIds.length === 0) {
			return;
		}
		const allInBacklog = pendingTaskStartAfterCreateIds.every((taskId) => {
			const selection = findCardSelection(board, taskId);
			return selection?.column.id === "backlog";
		});
		if (!allInBacklog) {
			return;
		}
		startTasksWithServiceSetupPrompt(pendingTaskStartAfterCreateIds);
		setPendingTaskStartAfterCreateIds(null);
	}, [board, pendingTaskStartAfterCreateIds, startTasksWithServiceSetupPrompt]);

	return {
		handleCreateAndStartTask,
		handleCreateAndStartTasks,
		handleStartTaskWithServiceSetupPrompt,
		handleStartAllBacklogTasksWithServiceSetupPrompt,
		taskStartServicePromptDialogOpen: pendingTaskStartServicePromptQueue.length > 0,
		taskStartServicePromptDialogPrompt,
		taskStartServicePromptDoNotShowAgain,
		setTaskStartServicePromptDoNotShowAgain,
		handleCloseTaskStartServicePrompt,
		handleRunTaskStartServiceInstallCommand: taskStartServicePromptDialogPrompt?.installCommand
			? handleRunTaskStartServiceInstallCommand
			: undefined,
	};
}
