import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTaskSessions } from "@/hooks/use-task-sessions";
import type { BoardCard } from "@/types";

const startTaskSessionMutateMock = vi.hoisted(() => vi.fn());
const trackTaskResumedFromTrashMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		runtime: {
			startTaskSession: {
				mutate: startTaskSessionMutateMock,
			},
		},
	}),
}));

vi.mock("@/runtime/task-session-geometry", () => ({
	estimateTaskSessionGeometry: () => ({ cols: 120, rows: 40 }),
}));

vi.mock("@/telemetry/events", () => ({
	trackTaskResumedFromTrash: trackTaskResumedFromTrashMock,
}));

interface HookSnapshot {
	startTaskSession: ReturnType<typeof useTaskSessions>["startTaskSession"];
}

function createTask(): BoardCard {
	return {
		id: "task-1",
		prompt: "Resume me",
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit",
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
	};
}

function HookHarness({ onSnapshot }: { onSnapshot: (snapshot: HookSnapshot) => void }): null {
	const sessions = useTaskSessions({
		currentProjectId: "project-1",
		setSessions: () => {},
		onWorktreeError: () => {},
	});

	useEffect(() => {
		onSnapshot({
			startTaskSession: sessions.startTaskSession,
		});
	}, [onSnapshot, sessions.startTaskSession]);

	return null;
}

describe("useTaskSessions", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		startTaskSessionMutateMock.mockReset();
		trackTaskResumedFromTrashMock.mockReset();
		startTaskSessionMutateMock.mockResolvedValue({
			ok: true,
			summary: {
				taskId: "task-1",
				state: "running",
				agentId: "codex",
				workspacePath: "/tmp/task-1",
				pid: 123,
				startedAt: 1,
				updatedAt: 1,
				lastOutputAt: null,
				reviewReason: null,
				exitCode: null,
			},
		});
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

	it("tracks successful resume-from-trash starts", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			await latestSnapshot?.startTaskSession(createTask(), { resumeFromTrash: true });
		});

		expect(trackTaskResumedFromTrashMock).toHaveBeenCalledTimes(1);
	});

	it("does not track regular task starts", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			await latestSnapshot?.startTaskSession(createTask());
		});

		expect(trackTaskResumedFromTrashMock).not.toHaveBeenCalled();
	});
});
