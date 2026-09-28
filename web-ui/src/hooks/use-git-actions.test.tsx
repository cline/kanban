import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type UseGitActionsResult, useGitActions } from "@/hooks/use-git-actions";
import type {
	RuntimeConfigResponse,
	RuntimeTaskSessionSummary,
	RuntimeTaskWorkspaceInfoResponse,
	RuntimeWorkspaceStateResponse,
} from "@/runtime/types";
import { clearTaskWorkspaceInfo, clearTaskWorkspaceSnapshot } from "@/stores/workspace-metadata-store";
import type { BoardData } from "@/types";

const showAppToastMock = vi.hoisted(() => vi.fn());
const useGitHistoryDataMock = vi.hoisted(() => vi.fn());
const fetchWorkspaceStateMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/app-toaster", () => ({
	showAppToast: showAppToastMock,
}));

vi.mock("@/components/git-history/use-git-history-data", () => ({
	useGitHistoryData: useGitHistoryDataMock,
}));

vi.mock("@/runtime/workspace-state-query", () => ({
	fetchWorkspaceState: fetchWorkspaceStateMock,
}));

interface HookSnapshot {
	handleAgentCommitTask: UseGitActionsResult["handleAgentCommitTask"];
	runAutoReviewGitAction: UseGitActionsResult["runAutoReviewGitAction"];
}

function createGitHistoryResult(): UseGitActionsResult["gitHistory"] {
	return {
		viewMode: "commit",
		refs: [],
		activeRef: null,
		refsErrorMessage: null,
		isRefsLoading: false,
		workingCopyFileCount: 0,
		hasWorkingCopy: false,
		commits: [],
		totalCommitCount: 0,
		selectedCommitHash: null,
		selectedCommit: null,
		isLogLoading: false,
		isLoadingMoreCommits: false,
		logErrorMessage: null,
		diffSource: null,
		isDiffLoading: false,
		diffErrorMessage: null,
		selectedDiffPath: null,
		selectWorkingCopy: () => {},
		selectRef: () => {},
		selectCommit: () => {},
		selectDiffPath: () => {},
		loadMoreCommits: () => {},
		refresh: () => {},
	};
}

function createBoard(): BoardData {
	return {
		columns: [
			{
				id: "review",
				title: "Review",
				cards: [
					{
						id: "task-1",
						title: "Ship it",
						prompt: "Ship it",
						startInPlanMode: false,
						autoReviewEnabled: false,
						autoReviewMode: "commit",
						baseRef: "main",
						createdAt: 1,
						updatedAt: 1,
					},
				],
			},
		],
		dependencies: [],
	};
}

function createRuntimeConfig(selectedAgentId: RuntimeConfigResponse["selectedAgentId"]): RuntimeConfigResponse {
	return {
		selectedAgentId,
		selectedShortcutLabel: null,
		agentAutonomousModeEnabled: true,
		effectiveCommand: null,
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project-config.json",
		readyForReviewNotificationsEnabled: true,
		detectedCommands: [],
		agents: [
			{
				id: selectedAgentId,
				label: selectedAgentId,
				binary: selectedAgentId,
				command: selectedAgentId,
				defaultArgs: [],
				installed: true,
				configured: true,
			},
		],
		shortcuts: [],
		clineProviderSettings: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4",
			baseUrl: null,
			apiKeyConfigured: true,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		},
		commitPromptTemplate: "commit",
		openPrPromptTemplate: "pr",
		commitPromptTemplateDefault: "commit",
		openPrPromptTemplateDefault: "pr",
	};
}

function createWorkspaceInfo(): RuntimeTaskWorkspaceInfoResponse {
	return {
		taskId: "task-1",
		path: "/tmp/task-1",
		exists: true,
		baseRef: "main",
		branch: "task-1",
		isDetached: false,
		headCommit: "abc1234",
	};
}

function createSessionSummary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "idle",
		agentId: "codex",
		workspacePath: "/tmp/task-1",
		pid: 1,
		startedAt: 1,
		updatedAt: 1,
		lastOutputAt: 1000,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		warningMessage: null,
		...overrides,
	};
}

function createWorkspaceState(summary: RuntimeTaskSessionSummary): RuntimeWorkspaceStateResponse {
	return {
		repoPath: "/tmp/project-1",
		statePath: "/tmp/project-1/.cline/kanban",
		git: {
			currentBranch: "main",
			defaultBranch: "main",
			branches: ["main"],
		},
		board: createBoard(),
		sessions: {
			[summary.taskId]: summary,
		},
		revision: 1,
	};
}

function HookHarness({
	onSnapshot,
	sendTaskSessionInput,
	sendTaskChatMessage,
	selectedAgentId = "cline",
}: {
	onSnapshot: (snapshot: HookSnapshot) => void;
	sendTaskSessionInput: Parameters<typeof useGitActions>[0]["sendTaskSessionInput"];
	sendTaskChatMessage: Parameters<typeof useGitActions>[0]["sendTaskChatMessage"];
	selectedAgentId?: RuntimeConfigResponse["selectedAgentId"];
}): null {
	const gitActions = useGitActions({
		currentProjectId: "project-1",
		board: createBoard(),
		selectedCard: null,
		runtimeProjectConfig: createRuntimeConfig(selectedAgentId),
		sendTaskSessionInput,
		sendTaskChatMessage,
		fetchTaskWorkspaceInfo: async () => createWorkspaceInfo(),
		isGitHistoryOpen: false,
		refreshWorkspaceState: async () => {},
	});

	useEffect(() => {
		onSnapshot({
			handleAgentCommitTask: gitActions.handleAgentCommitTask,
			runAutoReviewGitAction: gitActions.runAutoReviewGitAction,
		});
	}, [gitActions.handleAgentCommitTask, gitActions.runAutoReviewGitAction, onSnapshot]);

	return null;
}

describe("useGitActions", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		showAppToastMock.mockReset();
		useGitHistoryDataMock.mockReset();
		useGitHistoryDataMock.mockReturnValue(createGitHistoryResult());
		fetchWorkspaceStateMock.mockReset();
		fetchWorkspaceStateMock.mockResolvedValue(createWorkspaceState(createSessionSummary()));
		clearTaskWorkspaceInfo("task-1");
		clearTaskWorkspaceSnapshot("task-1");
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		vi.useRealTimers();
		clearTaskWorkspaceInfo("task-1");
		clearTaskWorkspaceSnapshot("task-1");
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	function useDeliveryFakeTimers(): void {
		vi.useFakeTimers({
			toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
		});
	}

	async function renderHarness(args: {
		selectedAgentId?: RuntimeConfigResponse["selectedAgentId"];
		sendTaskSessionInput: Parameters<typeof useGitActions>[0]["sendTaskSessionInput"];
		sendTaskChatMessage?: Parameters<typeof useGitActions>[0]["sendTaskChatMessage"];
	}): Promise<HookSnapshot> {
		let latestSnapshot: HookSnapshot | null = null;
		await act(async () => {
			root.render(
				<HookHarness
					selectedAgentId={args.selectedAgentId}
					sendTaskSessionInput={args.sendTaskSessionInput}
					sendTaskChatMessage={args.sendTaskChatMessage ?? (async () => ({ ok: true }))}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});
		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}
		return latestSnapshot;
	}

	async function flushUntil(predicate: () => boolean): Promise<void> {
		for (let i = 0; i < 20 && !predicate(); i += 1) {
			await Promise.resolve();
		}
		await Promise.resolve();
		await Promise.resolve();
	}

	it("sends commit prompts through the native cline chat API", async () => {
		const sendTaskSessionInput = vi.fn(async () => ({ ok: true }));
		const sendTaskChatMessage = vi.fn(async () => ({ ok: true }));
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					sendTaskSessionInput={sendTaskSessionInput}
					sendTaskChatMessage={sendTaskChatMessage}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot?.handleAgentCommitTask("task-1");
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(sendTaskChatMessage).toHaveBeenCalledWith("task-1", expect.any(String), { mode: "act" });
		expect(sendTaskSessionInput).not.toHaveBeenCalled();
		expect(showAppToastMock).not.toHaveBeenCalled();
	});

	it("submits a git-action prompt after a slow session paste lands instead of after a 200ms timer", async () => {
		useDeliveryFakeTimers();
		const pasteLandedAfterMs = 400;
		const startedAt = Date.now();
		let enterSentAt: number | null = null;
		const sessionInputCalls: Array<{ text: string; at: number }> = [];
		fetchWorkspaceStateMock.mockImplementation(async () => {
			const pasteLanded = Date.now() - startedAt >= pasteLandedAfterMs;
			const submitted = enterSentAt !== null;
			return createWorkspaceState(
				createSessionSummary({
					lastOutputAt: submitted ? 3000 : pasteLanded ? 2000 : 1000,
					state: submitted ? "running" : "idle",
				}),
			);
		});
		const sendTaskSessionInput = vi.fn(async (_taskId: string, text: string) => {
			const at = Date.now();
			sessionInputCalls.push({ text, at });
			if (text === "\r") {
				enterSentAt = at;
			}
			return { ok: true };
		});
		const snapshot = await renderHarness({
			selectedAgentId: "codex",
			sendTaskSessionInput,
		});

		let submitted: boolean | undefined;
		await act(async () => {
			const actionPromise = snapshot.runAutoReviewGitAction("task-1", "commit");
			await flushUntil(() => sessionInputCalls.length > 0);
			expect(sessionInputCalls.some((call) => call.text !== "\r")).toBe(true);
			await vi.advanceTimersByTimeAsync(200);
			expect(sessionInputCalls.some((call) => call.text === "\r")).toBe(false);
			await vi.advanceTimersByTimeAsync(250);
			submitted = await actionPromise;
		});

		expect(submitted).toBe(true);
		const enterCall = sessionInputCalls.find((call) => call.text === "\r");
		expect(enterCall).toBeDefined();
		expect((enterCall?.at ?? 0) - startedAt).toBeGreaterThanOrEqual(pasteLandedAfterMs);
		expect(showAppToastMock).not.toHaveBeenCalled();
	});

	it("retries submit once and returns failure when the session never becomes active", async () => {
		useDeliveryFakeTimers();
		const sessionInputCalls: Array<{ text: string; at: number }> = [];
		fetchWorkspaceStateMock.mockImplementation(async () => {
			const pasteSent = sessionInputCalls.some((call) => call.text !== "\r");
			return createWorkspaceState(
				createSessionSummary({
					lastOutputAt: pasteSent ? 2000 : 1000,
					state: "idle",
				}),
			);
		});
		const sendTaskSessionInput = vi.fn(async (_taskId: string, text: string) => {
			sessionInputCalls.push({ text, at: Date.now() });
			return { ok: true };
		});
		const snapshot = await renderHarness({
			selectedAgentId: "codex",
			sendTaskSessionInput,
		});

		let submitted: boolean | undefined;
		await act(async () => {
			const actionPromise = snapshot.runAutoReviewGitAction("task-1", "commit");
			await flushUntil(() => sessionInputCalls.length > 0);
			await vi.advanceTimersByTimeAsync(10_000);
			submitted = await actionPromise;
		});

		expect(submitted).toBe(false);
		expect(sessionInputCalls.filter((call) => call.text === "\r")).toHaveLength(2);
		expect(showAppToastMock).toHaveBeenCalledWith(
			expect.objectContaining({
				intent: "danger",
				message: "Could not confirm the prompt was submitted to the task session.",
			}),
		);
	});

	it("does not wait 200ms when paste and submit are confirmed immediately", async () => {
		useDeliveryFakeTimers();
		const startedAt = Date.now();
		const sessionInputCalls: Array<{ text: string; at: number }> = [];
		fetchWorkspaceStateMock.mockImplementation(async () => {
			const pasteSent = sessionInputCalls.some((call) => call.text !== "\r");
			const enterSent = sessionInputCalls.some((call) => call.text === "\r");
			return createWorkspaceState(
				createSessionSummary({
					lastOutputAt: enterSent ? 3000 : pasteSent ? 2000 : 1000,
					state: enterSent ? "running" : "idle",
				}),
			);
		});
		const sendTaskSessionInput = vi.fn(async (_taskId: string, text: string) => {
			sessionInputCalls.push({ text, at: Date.now() });
			return { ok: true };
		});
		const snapshot = await renderHarness({
			selectedAgentId: "codex",
			sendTaskSessionInput,
		});

		let submitted: boolean | undefined;
		await act(async () => {
			const actionPromise = snapshot.runAutoReviewGitAction("task-1", "commit");
			await flushUntil(() => sessionInputCalls.some((call) => call.text === "\r"));
			expect(sessionInputCalls.filter((call) => call.text === "\r")).toHaveLength(1);
			expect(Date.now() - startedAt).toBeLessThan(200);
			submitted = await actionPromise;
		});

		expect(submitted).toBe(true);
		expect(showAppToastMock).not.toHaveBeenCalled();
	});
});
