import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePrewarmedAgentTerminals } from "@/hooks/use-prewarmed-agent-terminals";
import { getDetailTerminalTaskId } from "@/hooks/use-terminal-panels";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";

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

function HookHarness({
	currentProjectId,
	isWorkspaceReady = true,
	sessions,
}: {
	currentProjectId: string | null;
	isWorkspaceReady?: boolean;
	sessions: Record<string, RuntimeTaskSessionSummary>;
}): null {
	usePrewarmedAgentTerminals({
		currentProjectId,
		isWorkspaceReady,
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
		const sessions = {
			"task-running": createSummary("task-running"),
			"task-review": createSummary("task-review", { state: "awaiting_review" }),
			"task-idle": createSummary("task-idle", { state: "idle" }),
			"task-shell": createSummary("task-shell", { agentId: null }),
		};

		await act(async () => {
			root.render(<HookHarness currentProjectId="project-1" sessions={sessions} />);
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

	it("disposes terminals that are no longer active and cleans up on workspace changes", async () => {
		const initialSessions = {
			"task-a": createSummary("task-a"),
			"task-b": createSummary("task-b", { state: "awaiting_review" }),
		};
		const nextSessions = {
			"task-b": createSummary("task-b", { state: "awaiting_review" }),
			"task-c": createSummary("task-c"),
		};

		await act(async () => {
			root.render(<HookHarness currentProjectId="project-1" sessions={initialSessions} />);
		});

		ensurePersistentTerminalMock.mockClear();
		disposePersistentTerminalMock.mockClear();
		disposeAllPersistentTerminalsForWorkspaceMock.mockClear();

		await act(async () => {
			root.render(<HookHarness currentProjectId="project-1" sessions={nextSessions} />);
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
			root.render(<HookHarness currentProjectId="project-2" sessions={nextSessions} />);
		});

		expect(disposeAllPersistentTerminalsForWorkspaceMock).toHaveBeenCalledTimes(1);
		expect(disposeAllPersistentTerminalsForWorkspaceMock).toHaveBeenCalledWith("project-1");
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
		const projectOneSessions = {
			"task-a": createSummary("task-a"),
		};
		const projectTwoSessions = {
			"task-c": createSummary("task-c"),
		};

		await act(async () => {
			root.render(<HookHarness currentProjectId="project-1" sessions={projectOneSessions} />);
		});

		ensurePersistentTerminalMock.mockClear();
		disposePersistentTerminalMock.mockClear();
		disposeAllPersistentTerminalsForWorkspaceMock.mockClear();

		await act(async () => {
			root.render(
				<HookHarness currentProjectId="project-2" isWorkspaceReady={false} sessions={projectOneSessions} />,
			);
		});

		expect(disposeAllPersistentTerminalsForWorkspaceMock).toHaveBeenCalledTimes(1);
		expect(disposeAllPersistentTerminalsForWorkspaceMock).toHaveBeenCalledWith("project-1");
		expect(ensurePersistentTerminalMock).not.toHaveBeenCalled();
		expect(disposePersistentTerminalMock).not.toHaveBeenCalled();

		await act(async () => {
			root.render(<HookHarness currentProjectId="project-2" isWorkspaceReady sessions={projectTwoSessions} />);
		});

		expect(ensurePersistentTerminalMock).toHaveBeenCalledTimes(1);
		expect(ensurePersistentTerminalMock).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-c",
				workspaceId: "project-2",
			}),
		);
	});
});
