import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type UseGitActionsResult, useGitActions } from "@/hooks/use-git-actions";
import type { RuntimeAgentId, RuntimeConfigResponse, RuntimeTaskWorkspaceInfoResponse } from "@/runtime/types";
import { clearTaskWorkspaceInfo, clearTaskWorkspaceSnapshot } from "@/stores/workspace-metadata-store";
import type { BoardData } from "@/types";

const showAppToastMock = vi.hoisted(() => vi.fn());
const useGitHistoryDataMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/app-toaster", () => ({
	showAppToast: showAppToastMock,
}));

vi.mock("@/components/git-history/use-git-history-data", () => ({
	useGitHistoryData: useGitHistoryDataMock,
}));

interface HookSnapshot {
	handleCommitTask: UseGitActionsResult["handleCommitTask"];
	handleAgentCommitTask: UseGitActionsResult["handleAgentCommitTask"];
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

function createBoard(agentId?: RuntimeAgentId): BoardData {
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
						...(agentId ? { agentId } : {}),
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

function HookHarness({
	onSnapshot,
	board = createBoard(),
	runtimeProjectConfig = createRuntimeConfig("cline"),
	sendTaskSessionInput,
	sendTaskChatMessage,
}: {
	onSnapshot: (snapshot: HookSnapshot) => void;
	board?: BoardData;
	runtimeProjectConfig?: RuntimeConfigResponse;
	sendTaskSessionInput: Parameters<typeof useGitActions>[0]["sendTaskSessionInput"];
	sendTaskChatMessage: Parameters<typeof useGitActions>[0]["sendTaskChatMessage"];
}): null {
	const gitActions = useGitActions({
		currentProjectId: "project-1",
		board,
		selectedCard: null,
		runtimeProjectConfig,
		sendTaskSessionInput,
		sendTaskChatMessage,
		fetchTaskWorkspaceInfo: async () => createWorkspaceInfo(),
		isGitHistoryOpen: false,
		refreshWorkspaceState: async () => {},
	});

	useEffect(() => {
		onSnapshot({
			handleCommitTask: gitActions.handleCommitTask,
			handleAgentCommitTask: gitActions.handleAgentCommitTask,
		});
	}, [gitActions.handleAgentCommitTask, gitActions.handleCommitTask, onSnapshot]);

	return null;
}

describe("useGitActions", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	async function commitFromReviewCard(args: {
		projectAgentId: RuntimeConfigResponse["selectedAgentId"];
		cardAgentId?: RuntimeAgentId;
	}): Promise<{
		sendTaskSessionInput: ReturnType<typeof vi.fn>;
		sendTaskChatMessage: ReturnType<typeof vi.fn>;
	}> {
		const sendTaskSessionInput = vi.fn(async () => ({ ok: true }));
		const sendTaskChatMessage = vi.fn(async () => ({ ok: true }));
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					board={createBoard(args.cardAgentId)}
					runtimeProjectConfig={createRuntimeConfig(args.projectAgentId)}
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
			latestSnapshot?.handleCommitTask("task-1");
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		return { sendTaskSessionInput, sendTaskChatMessage };
	}

	beforeEach(() => {
		showAppToastMock.mockReset();
		useGitHistoryDataMock.mockReset();
		useGitHistoryDataMock.mockReturnValue(createGitHistoryResult());
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
		clearTaskWorkspaceInfo("task-1");
		clearTaskWorkspaceSnapshot("task-1");
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

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

	it("routes a cline card override to chat when the project default is a terminal agent", async () => {
		const { sendTaskSessionInput, sendTaskChatMessage } = await commitFromReviewCard({
			projectAgentId: "codex",
			cardAgentId: "cline",
		});

		expect(sendTaskChatMessage).toHaveBeenCalledWith("task-1", expect.any(String), { mode: "act" });
		expect(sendTaskSessionInput).not.toHaveBeenCalled();
		expect(showAppToastMock).not.toHaveBeenCalled();
	});

	it("routes a terminal card override to the session when the project default is cline", async () => {
		const { sendTaskSessionInput, sendTaskChatMessage } = await commitFromReviewCard({
			projectAgentId: "cline",
			cardAgentId: "codex",
		});

		expect(sendTaskChatMessage).not.toHaveBeenCalled();
		expect(sendTaskSessionInput).toHaveBeenCalledWith("task-1", expect.any(String), {
			appendNewline: false,
			mode: "paste",
		});

		await act(async () => {
			await new Promise<void>((resolve) => {
				window.setTimeout(resolve, 200);
			});
		});

		expect(sendTaskSessionInput).toHaveBeenCalledWith("task-1", "\r", { appendNewline: false });
		expect(showAppToastMock).not.toHaveBeenCalled();
	});

	it("routes a card with no agent override through cline chat when the project default is cline", async () => {
		const { sendTaskSessionInput, sendTaskChatMessage } = await commitFromReviewCard({
			projectAgentId: "cline",
		});

		expect(sendTaskChatMessage).toHaveBeenCalledWith("task-1", expect.any(String), { mode: "act" });
		expect(sendTaskSessionInput).not.toHaveBeenCalled();
		expect(showAppToastMock).not.toHaveBeenCalled();
	});

	it("routes a card with no agent override through the session when the project default is a terminal agent", async () => {
		const { sendTaskSessionInput, sendTaskChatMessage } = await commitFromReviewCard({
			projectAgentId: "codex",
		});

		expect(sendTaskChatMessage).not.toHaveBeenCalled();
		expect(sendTaskSessionInput).toHaveBeenCalledWith("task-1", expect.any(String), {
			appendNewline: false,
			mode: "paste",
		});

		await act(async () => {
			await new Promise<void>((resolve) => {
				window.setTimeout(resolve, 200);
			});
		});

		expect(sendTaskSessionInput).toHaveBeenCalledWith("task-1", "\r", { appendNewline: false });
		expect(showAppToastMock).not.toHaveBeenCalled();
	});
});
