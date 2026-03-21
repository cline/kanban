import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useClineChatRuntimeActions } from "@/hooks/use-cline-chat-runtime-actions";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";

const sendTaskChatMessageMutateMock = vi.hoisted(() => vi.fn());
const getTaskChatMessagesQueryMock = vi.hoisted(() => vi.fn());
const abortTaskChatTurnMutateMock = vi.hoisted(() => vi.fn());
const cancelTaskChatTurnMutateMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		runtime: {
			sendTaskChatMessage: {
				mutate: sendTaskChatMessageMutateMock,
			},
			getTaskChatMessages: {
				query: getTaskChatMessagesQueryMock,
			},
			abortTaskChatTurn: {
				mutate: abortTaskChatTurnMutateMock,
			},
			cancelTaskChatTurn: {
				mutate: cancelTaskChatTurnMutateMock,
			},
		},
	}),
}));

interface HookSnapshot {
	sendTaskChatMessage: ReturnType<typeof useClineChatRuntimeActions>["sendTaskChatMessage"];
	loadTaskChatMessages: ReturnType<typeof useClineChatRuntimeActions>["loadTaskChatMessages"];
	abortTaskChatTurn: ReturnType<typeof useClineChatRuntimeActions>["abortTaskChatTurn"];
	cancelTaskChatTurn: ReturnType<typeof useClineChatRuntimeActions>["cancelTaskChatTurn"];
}

function createSummary(taskId: string): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "running",
		agentId: "cline",
		workspacePath: "/tmp/worktree",
		pid: null,
		startedAt: 1,
		updatedAt: 1,
		lastOutputAt: 1,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}

function HookHarness({
	currentProjectId,
	onSessionSummary,
	onSnapshot,
}: {
	currentProjectId: string | null;
	onSessionSummary: (summary: RuntimeTaskSessionSummary) => void;
	onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
	const state = useClineChatRuntimeActions({
		currentProjectId,
		onSessionSummary,
	});

	useEffect(() => {
		onSnapshot(state);
	}, [onSnapshot, state]);

	return null;
}

describe("useClineChatRuntimeActions", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		sendTaskChatMessageMutateMock.mockReset();
		getTaskChatMessagesQueryMock.mockReset();
		abortTaskChatTurnMutateMock.mockReset();
		cancelTaskChatTurnMutateMock.mockReset();
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

	it("routes send, load, abort, and cancel through the runtime client and upserts returned summaries", async () => {
		const summary = createSummary("task-1");
		const onSessionSummary = vi.fn();
		let latestSnapshot: HookSnapshot | null = null;

		sendTaskChatMessageMutateMock.mockResolvedValue({
			ok: true,
			summary,
			message: {
				id: "message-2",
				role: "user",
				content: "hello",
				createdAt: 2,
			},
		});
		getTaskChatMessagesQueryMock.mockResolvedValue({
			ok: true,
			messages: [
				{
					id: "message-1",
					role: "assistant",
					content: "Recovered",
					createdAt: 1,
				},
			],
		});
		abortTaskChatTurnMutateMock.mockResolvedValue({
			ok: true,
			summary,
		});
		cancelTaskChatTurnMutateMock.mockResolvedValue({
			ok: true,
			summary,
		});

		await act(async () => {
			root.render(
				<HookHarness
					currentProjectId="project-1"
					onSessionSummary={onSessionSummary}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected hook snapshot.");
		}

		await act(async () => {
			expect(await latestSnapshot?.sendTaskChatMessage("task-1", "hello", { mode: "plan" })).toEqual({
				ok: true,
				chatMessage: {
					id: "message-2",
					role: "user",
					content: "hello",
					createdAt: 2,
				},
			});
			expect(await latestSnapshot?.loadTaskChatMessages("task-1")).toEqual([
				{
					id: "message-1",
					role: "assistant",
					content: "Recovered",
					createdAt: 1,
				},
			]);
			expect(await latestSnapshot?.abortTaskChatTurn("task-1")).toEqual({ ok: true });
			expect(await latestSnapshot?.cancelTaskChatTurn("task-1")).toEqual({ ok: true });
		});

		expect(sendTaskChatMessageMutateMock).toHaveBeenCalledWith({
			taskId: "task-1",
			text: "hello",
			mode: "plan",
		});
		expect(getTaskChatMessagesQueryMock).toHaveBeenCalledWith({ taskId: "task-1" });
		expect(abortTaskChatTurnMutateMock).toHaveBeenCalledWith({ taskId: "task-1" });
		expect(cancelTaskChatTurnMutateMock).toHaveBeenCalledWith({ taskId: "task-1" });
		expect(onSessionSummary).toHaveBeenCalledTimes(3);
		expect(onSessionSummary).toHaveBeenNthCalledWith(1, summary);
		expect(onSessionSummary).toHaveBeenNthCalledWith(2, summary);
		expect(onSessionSummary).toHaveBeenNthCalledWith(3, summary);
	});

	it("forwards chat images to the runtime mutation", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					currentProjectId="project-1"
					onSessionSummary={() => {}}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected hook snapshot.");
		}

		await act(async () => {
			await latestSnapshot?.sendTaskChatMessage("task-1", "hello", {
				images: [
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
			});
		});

		expect(sendTaskChatMessageMutateMock).toHaveBeenCalledWith({
			taskId: "task-1",
			text: "hello",
			images: [
				{
					id: "img-1",
					data: "abc123",
					mimeType: "image/png",
				},
			],
		});
	});

	it("returns a no-project error without hitting the runtime client", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					currentProjectId={null}
					onSessionSummary={() => {}}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected hook snapshot.");
		}

		await act(async () => {
			expect(await latestSnapshot?.sendTaskChatMessage("task-1", "hello")).toEqual({
				ok: false,
				message: "No project selected.",
			});
			expect(await latestSnapshot?.abortTaskChatTurn("task-1")).toEqual({
				ok: false,
				message: "No project selected.",
			});
			expect(await latestSnapshot?.cancelTaskChatTurn("task-1")).toEqual({
				ok: false,
				message: "No project selected.",
			});
			expect(await latestSnapshot?.loadTaskChatMessages("task-1")).toBeNull();
		});

		expect(sendTaskChatMessageMutateMock).not.toHaveBeenCalled();
		expect(getTaskChatMessagesQueryMock).not.toHaveBeenCalled();
		expect(abortTaskChatTurnMutateMock).not.toHaveBeenCalled();
		expect(cancelTaskChatTurnMutateMock).not.toHaveBeenCalled();
	});
});
