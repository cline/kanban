import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePrewarmedAgentTerminals } from "@/hooks/use-prewarmed-agent-terminals";
import { getDetailTerminalTaskId } from "@/hooks/use-terminal-panels";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardData } from "@/types";

const ensurePersistentTerminalMock = vi.hoisted(() => vi.fn());
const disposePersistentTerminalMock = vi.hoisted(() => vi.fn());
const disposeAllPersistentTerminalsForWorkspaceMock = vi.hoisted(() => vi.fn());

vi.mock("@/terminal/persistent-terminal-manager", () => ({
	ensurePersistentTerminal: ensurePersistentTerminalMock,
	disposePersistentTerminal: disposePersistentTerminalMock,
	disposeAllPersistentTerminalsForWorkspace: disposeAllPersistentTerminalsForWorkspaceMock,
}));

function createSummary(taskId: string, overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "running",
		agentId: "codex",
		workspacePath: `/tmp/${taskId}`,
		pid: 123,
		startedAt: 1,
		updatedAt: 1,
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		...overrides,
	};
}

function createBoard(input?: {
	inProgressTaskIds?: string[];
	reviewTaskIds?: string[];
	backlogTaskIds?: string[];
	trashTaskIds?: string[];
}): BoardData {
	const inProgressTaskIds = input?.inProgressTaskIds ?? [];
	const reviewTaskIds = input?.reviewTaskIds ?? [];
	const backlogTaskIds = input?.backlogTaskIds ?? [];
	const trashTaskIds = input?.trashTaskIds ?? [];
	const createCard = (taskId: string, index: number) => ({
		id: taskId,
		prompt: taskId,
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit" as const,
		baseRef: "main",
		createdAt: index,
		updatedAt: index,
	});
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: backlogTaskIds.map(createCard) },
			{ id: "in_progress", title: "In Progress", cards: inProgressTaskIds.map(createCard) },
			{ id: "review", title: "Review", cards: reviewTaskIds.map(createCard) },
			{ id: "trash", title: "Trash", cards: trashTaskIds.map(createCard) },
		],
		dependencies: [],
	};
}

function HookHarness({
	currentProjectId,
	isWorkspaceReady = true,
	isRuntimeDisconnected = false,
	board,
	sessions,
}: {
	currentProjectId: string | null;
	isWorkspaceReady?: boolean;
	isRuntimeDisconnected?: boolean;
	board: BoardData;
	sessions: Record<string, RuntimeTaskSessionSummary>;
}): null {
	usePrewarmedAgentTerminals({
		currentProjectId,
		isWorkspaceReady,
		isRuntimeDisconnected,
		board,
		sessions,
		cursorColor: "cursor-color",
		terminalBackgroundColor: "terminal-background",
	});

	return null;
}

describe("usePrewarmedAgentTerminals", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		ensurePersistentTerminalMock.mockReset();
		disposePersistentTerminalMock.mockReset();
		disposeAllPersistentTerminalsForWorkspaceMock.mockReset();
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
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("prewarms active agent task terminals and ignores idle or non-agent sessions", async () => {
		const board = createBoard({
			inProgressTaskIds: ["task-running", "task-idle"],
			reviewTaskIds: ["task-review", "task-shell"],
			trashTaskIds: ["task-trash"],
		});
		const sessions = {
			"task-running": createSummary("task-running"),
			"task-review": createSummary("task-review", { state: "awaiting_review" }),
			"task-idle": createSummary("task-idle", { state: "idle" }),
			"task-shell": createSummary("task-shell", { agentId: null }),
			"task-trash": createSummary("task-trash"),
		};

		await act(async () => {
			root.render(<HookHarness currentProjectId="project-1" board={board} sessions={sessions} />);
		});

		expect(ensurePersistentTerminalMock).toHaveBeenCalledTimes(2);
		expect(ensurePersistentTerminalMock).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-running",
				workspaceId: "project-1",
			}),
		);
		expect(ensurePersistentTerminalMock).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-review",
				workspaceId: "project-1",
			}),
		);
		expect(disposePersistentTerminalMock).not.toHaveBeenCalled();
	});

	it("disposes terminals that are no longer active and keeps other workspace sockets open on switch", async () => {
		const initialBoard = createBoard({ inProgressTaskIds: ["task-a"], reviewTaskIds: ["task-b"] });
		const initialSessions = {
			"task-a": createSummary("task-a"),
			"task-b": createSummary("task-b", { state: "awaiting_review" }),
		};
		const nextBoard = createBoard({ inProgressTaskIds: ["task-c"], reviewTaskIds: ["task-b"] });
		const nextSessions = {
			"task-b": createSummary("task-b", { state: "awaiting_review" }),
			"task-c": createSummary("task-c"),
		};

		await act(async () => {
			root.render(<HookHarness currentProjectId="project-1" board={initialBoard} sessions={initialSessions} />);
		});

		ensurePersistentTerminalMock.mockClear();
		disposePersistentTerminalMock.mockClear();
		disposeAllPersistentTerminalsForWorkspaceMock.mockClear();

		await act(async () => {
			root.render(<HookHarness currentProjectId="project-1" board={nextBoard} sessions={nextSessions} />);
		});

		expect(ensurePersistentTerminalMock).toHaveBeenCalledTimes(2);
		expect(ensurePersistentTerminalMock).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-b",
				workspaceId: "project-1",
			}),
		);
		expect(ensurePersistentTerminalMock).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-c",
				workspaceId: "project-1",
			}),
		);
		expect(disposePersistentTerminalMock).toHaveBeenCalledTimes(2);
		expect(disposePersistentTerminalMock).toHaveBeenNthCalledWith(1, "project-1", "task-a");
		expect(disposePersistentTerminalMock).toHaveBeenNthCalledWith(2, "project-1", getDetailTerminalTaskId("task-a"));

		ensurePersistentTerminalMock.mockClear();
		disposePersistentTerminalMock.mockClear();
		disposeAllPersistentTerminalsForWorkspaceMock.mockClear();

		await act(async () => {
			root.render(<HookHarness currentProjectId="project-2" board={nextBoard} sessions={nextSessions} />);
		});

		expect(disposeAllPersistentTerminalsForWorkspaceMock).not.toHaveBeenCalled();
		expect(ensurePersistentTerminalMock).toHaveBeenCalledTimes(2);
		expect(ensurePersistentTerminalMock).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-b",
				workspaceId: "project-2",
			}),
		);
		expect(ensurePersistentTerminalMock).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-c",
				workspaceId: "project-2",
			}),
		);

		disposeAllPersistentTerminalsForWorkspaceMock.mockClear();

		await act(async () => {
			root.unmount();
		});

		expect(disposeAllPersistentTerminalsForWorkspaceMock).toHaveBeenCalledTimes(1);
		expect(disposeAllPersistentTerminalsForWorkspaceMock).toHaveBeenCalledWith("project-2");
	});

	it("skips prewarming stale sessions while a workspace switch is still pending", async () => {
		const projectOneBoard = createBoard({ inProgressTaskIds: ["task-a"] });
		const projectOneSessions = {
			"task-a": createSummary("task-a"),
		};
		const projectTwoBoard = createBoard({ inProgressTaskIds: ["task-c"] });
		const projectTwoSessions = {
			"task-c": createSummary("task-c"),
		};

		await act(async () => {
			root.render(<HookHarness currentProjectId="project-1" board={projectOneBoard} sessions={projectOneSessions} />);
		});

		ensurePersistentTerminalMock.mockClear();
		disposePersistentTerminalMock.mockClear();
		disposeAllPersistentTerminalsForWorkspaceMock.mockClear();

		await act(async () => {
			root.render(
				<HookHarness
					currentProjectId="project-2"
					isWorkspaceReady={false}
					board={projectOneBoard}
					sessions={projectOneSessions}
				/>,
			);
		});

		expect(disposeAllPersistentTerminalsForWorkspaceMock).not.toHaveBeenCalled();
		expect(ensurePersistentTerminalMock).not.toHaveBeenCalled();
		expect(disposePersistentTerminalMock).not.toHaveBeenCalled();

		await act(async () => {
			root.render(
				<HookHarness
					currentProjectId="project-2"
					isWorkspaceReady
					board={projectTwoBoard}
					sessions={projectTwoSessions}
				/>,
			);
		});

		expect(ensurePersistentTerminalMock).toHaveBeenCalledTimes(1);
		expect(ensurePersistentTerminalMock).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-c",
				workspaceId: "project-2",
			}),
		);
	});

	it("disposes task terminals when a card moves to trash", async () => {
		const activeBoard = createBoard({ inProgressTaskIds: ["task-a"] });
		const trashBoard = createBoard({ trashTaskIds: ["task-a"] });
		const sessions = {
			"task-a": createSummary("task-a"),
		};

		await act(async () => {
			root.render(<HookHarness currentProjectId="project-1" board={activeBoard} sessions={sessions} />);
		});

		expect(ensurePersistentTerminalMock).toHaveBeenCalledTimes(1);

		ensurePersistentTerminalMock.mockClear();
		disposePersistentTerminalMock.mockClear();

		await act(async () => {
			root.render(<HookHarness currentProjectId="project-1" board={trashBoard} sessions={sessions} />);
		});

		expect(ensurePersistentTerminalMock).not.toHaveBeenCalled();
		expect(disposePersistentTerminalMock).toHaveBeenCalledTimes(2);
		expect(disposePersistentTerminalMock).toHaveBeenNthCalledWith(1, "project-1", "task-a");
		expect(disposePersistentTerminalMock).toHaveBeenNthCalledWith(2, "project-1", getDetailTerminalTaskId("task-a"));
	});

	it("disposes all task terminals when runtime disconnects", async () => {
		const board = createBoard({ inProgressTaskIds: ["task-a"], reviewTaskIds: ["task-b"] });
		const sessions = {
			"task-a": createSummary("task-a"),
			"task-b": createSummary("task-b", { state: "awaiting_review" }),
		};

		await act(async () => {
			root.render(<HookHarness currentProjectId="project-1" board={board} sessions={sessions} />);
		});

		disposeAllPersistentTerminalsForWorkspaceMock.mockClear();
		ensurePersistentTerminalMock.mockClear();

		await act(async () => {
			root.render(
				<HookHarness
					currentProjectId="project-1"
					board={board}
					sessions={sessions}
					isRuntimeDisconnected
				/>,
			);
		});

		expect(disposeAllPersistentTerminalsForWorkspaceMock).toHaveBeenCalledTimes(1);
		expect(disposeAllPersistentTerminalsForWorkspaceMock).toHaveBeenCalledWith("project-1");
		expect(ensurePersistentTerminalMock).not.toHaveBeenCalled();
	});
});
