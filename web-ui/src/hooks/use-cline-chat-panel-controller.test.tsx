import { act, useCallback, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useClineChatPanelController } from "@/hooks/use-cline-chat-panel-controller";
import type {
	RuntimeTaskHookActivity,
	RuntimeTaskImage,
	RuntimeTaskSessionMode,
	RuntimeTaskSessionSummary,
} from "@/runtime/types";
import { resetWorkspaceMetadataStore, setTaskWorkspaceSnapshot } from "@/stores/workspace-metadata-store";

interface HookSnapshot {
	draft: string;
	messageIds: string[];
	lastMessageContent: string | null;
	canSend: boolean;
	canCancel: boolean;
	showReviewActions: boolean;
	showAgentProgressIndicator: boolean;
	showActionFooter: boolean;
	showCancelAutomaticAction: boolean;
	setDraft: (draft: string) => void;
	handleSendDraft: (mode?: RuntimeTaskSessionMode, images?: RuntimeTaskImage[]) => Promise<boolean>;
}

function createSummary(
	state: RuntimeTaskSessionSummary["state"],
	overrides: Partial<RuntimeTaskSessionSummary> = {},
): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state,
		agentId: "cline",
		workspacePath: "/tmp/worktree",
		pid: null,
		startedAt: 1,
		updatedAt: Date.now(),
		lastOutputAt: Date.now(),
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
		...overrides,
	};
}

function createHookActivity(hookEventName: string): RuntimeTaskHookActivity {
	return {
		activityText: "Agent active",
		toolName: null,
		toolInputSummary: null,
		finalMessage: null,
		hookEventName,
		notificationType: null,
		source: "cline-sdk",
	};
}

function requireSnapshot(snapshot: HookSnapshot | null): HookSnapshot {
	if (!snapshot) {
		throw new Error("Expected hook snapshot.");
	}
	return snapshot;
}

function HookHarness({
	summary,
	taskColumnId,
	onSendMessage,
	incomingMessages,
	incomingMessage,
	onSnapshot,
}: {
	summary: RuntimeTaskSessionSummary | null;
	taskColumnId?: string;
	onSendMessage?: (
		taskId: string,
		text: string,
		options?: { mode?: RuntimeTaskSessionMode; images?: RuntimeTaskImage[] },
	) => Promise<{
		ok: boolean;
		message?: string;
		chatMessage?: {
			id: string;
			role: "user" | "assistant" | "system" | "tool" | "reasoning" | "status";
			content: string;
			createdAt: number;
		} | null;
	}>;
	incomingMessage?: {
		id: string;
		role: "user" | "assistant" | "system" | "tool" | "reasoning" | "status";
		content: string;
		createdAt: number;
		meta?: {
			toolName?: string | null;
			hookEventName?: string | null;
			toolCallId?: string | null;
			streamType?: string | null;
		} | null;
	} | null;
	incomingMessages?:
		| {
				id: string;
				role: "user" | "assistant" | "system" | "tool" | "reasoning" | "status";
				content: string;
				createdAt: number;
				meta?: {
					toolName?: string | null;
					hookEventName?: string | null;
					toolCallId?: string | null;
					streamType?: string | null;
				} | null;
		  }[]
		| null;
	onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
	const loadMessages = useCallback(async () => [], []);
	const handleCommit = useCallback(() => {}, []);
	const handleOpenPr = useCallback(() => {}, []);
	const handleMoveToTrash = useCallback(() => {}, []);
	const handleCancelAutomaticAction = useCallback(() => {}, []);
	const state = useClineChatPanelController({
		taskId: "task-1",
		summary,
		taskColumnId,
		onSendMessage,
		onLoadMessages: loadMessages,
		incomingMessages,
		incomingMessage,
		onCommit: handleCommit,
		onOpenPr: handleOpenPr,
		onMoveToTrash: handleMoveToTrash,
		onCancelAutomaticAction: handleCancelAutomaticAction,
		cancelAutomaticActionLabel: "Cancel auto review",
		showMoveToTrash: true,
	});

	useEffect(() => {
		const lastMessage = state.messages.at(-1);
		onSnapshot({
			draft: state.draft,
			messageIds: state.messages.map((message) => message.id),
			lastMessageContent: lastMessage?.content ?? null,
			canSend: state.canSend,
			canCancel: state.canCancel,
			showReviewActions: state.showReviewActions,
			showAgentProgressIndicator: state.showAgentProgressIndicator,
			showActionFooter: state.showActionFooter,
			showCancelAutomaticAction: state.showCancelAutomaticAction,
			setDraft: state.setDraft,
			handleSendDraft: state.handleSendDraft,
		});
	}, [onSnapshot, state]);

	return null;
}

describe("useClineChatPanelController", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		resetWorkspaceMetadataStore();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		resetWorkspaceMetadataStore();
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("clears the draft and appends the returned chat message after send", async () => {
		const onSendMessage = vi.fn(async () => ({
			ok: true,
			chatMessage: {
				id: "sent-1",
				role: "user" as const,
				content: "Ship it",
				createdAt: 2,
			},
		}));
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					summary={null}
					onSendMessage={onSendMessage}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).setDraft("Ship it");
			await Promise.resolve();
		});

		expect(requireSnapshot(latestSnapshot).draft).toBe("Ship it");

		await act(async () => {
			await requireSnapshot(latestSnapshot).handleSendDraft("plan");
		});

		expect(onSendMessage).toHaveBeenCalledWith("task-1", "Ship it", { mode: "plan" });
		expect(requireSnapshot(latestSnapshot).draft).toBe("");
		expect(requireSnapshot(latestSnapshot).messageIds).toEqual(["sent-1"]);
		expect(requireSnapshot(latestSnapshot).lastMessageContent).toBe("Ship it");
	});

	it("derives footer and action flags from the panel inputs", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		setTaskWorkspaceSnapshot({
			taskId: "task-1",
			path: "/tmp/worktree",
			branch: "task-1",
			isDetached: false,
			headCommit: "abc1234",
			changedFiles: 2,
			additions: 4,
			deletions: 1,
		});

		await act(async () => {
			root.render(
				<HookHarness
					summary={createSummary("running")}
					taskColumnId="review"
					onSendMessage={async () => ({ ok: true })}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		expect(requireSnapshot(latestSnapshot).canSend).toBe(true);
		expect(requireSnapshot(latestSnapshot).canCancel).toBe(false);
		expect(requireSnapshot(latestSnapshot).showReviewActions).toBe(true);
		expect(requireSnapshot(latestSnapshot).showAgentProgressIndicator).toBe(true);
		expect(requireSnapshot(latestSnapshot).showActionFooter).toBe(true);
		expect(requireSnapshot(latestSnapshot).showCancelAutomaticAction).toBe(true);
	});

	it("hides review actions after the workspace becomes clean", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		setTaskWorkspaceSnapshot({
			taskId: "task-1",
			path: "/tmp/worktree",
			branch: "task-1",
			isDetached: false,
			headCommit: "abc1234",
			changedFiles: 1,
			additions: 1,
			deletions: 0,
		});

		await act(async () => {
			root.render(
				<HookHarness
					summary={createSummary("awaiting_review")}
					taskColumnId="review"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		expect(requireSnapshot(latestSnapshot).showReviewActions).toBe(true);

		await act(async () => {
			setTaskWorkspaceSnapshot({
				taskId: "task-1",
				path: "/tmp/worktree",
				branch: "task-1",
				isDetached: false,
				headCommit: "def5678",
				changedFiles: 0,
				additions: 0,
				deletions: 0,
			});
			await Promise.resolve();
		});

		expect(requireSnapshot(latestSnapshot).showReviewActions).toBe(false);
	});

	it("keeps the thinking indicator visible while assistant text is streaming", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					summary={createSummary("running", {
						latestHookActivity: createHookActivity("assistant_delta"),
					})}
					incomingMessage={{
						id: "assistant-1",
						role: "assistant",
						content: "H",
						createdAt: 2,
					}}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		expect(requireSnapshot(latestSnapshot).showAgentProgressIndicator).toBe(true);
	});

	it("keeps the thinking indicator visible when assistant chunks arrive through incomingMessages only", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					summary={createSummary("running")}
					incomingMessages={[
						{
							id: "assistant-1",
							role: "assistant",
							content: "H",
							createdAt: 2,
						},
					]}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		expect(requireSnapshot(latestSnapshot).showAgentProgressIndicator).toBe(true);

		await act(async () => {
			root.render(
				<HookHarness
					summary={createSummary("running")}
					incomingMessages={[
						{
							id: "assistant-1",
							role: "assistant",
							content: "Hello",
							createdAt: 2,
						},
					]}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		expect(requireSnapshot(latestSnapshot).showAgentProgressIndicator).toBe(true);
	});

	it("keeps the thinking indicator visible after assistant activity begins", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					summary={createSummary("running", {
						latestHookActivity: createHookActivity("assistant_delta"),
					})}
					incomingMessage={{
						id: "assistant-1",
						role: "assistant",
						content: "Let me edit this file",
						createdAt: 2,
					}}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		expect(requireSnapshot(latestSnapshot).showAgentProgressIndicator).toBe(true);
	});

	it("keeps the thinking indicator visible when a new turn starts", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					summary={createSummary("running", {
						latestHookActivity: createHookActivity("assistant_delta"),
					})}
					incomingMessage={{
						id: "assistant-1",
						role: "assistant",
						content: "Let me edit this file",
						createdAt: 2,
					}}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		expect(requireSnapshot(latestSnapshot).showAgentProgressIndicator).toBe(true);

		await act(async () => {
			root.render(
				<HookHarness
					summary={createSummary("running", {
						latestHookActivity: {
							activityText: "Agent active",
							toolName: null,
							toolInputSummary: null,
							finalMessage: null,
							hookEventName: "turn_start",
							notificationType: null,
							source: "cline-sdk",
						},
					})}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		expect(requireSnapshot(latestSnapshot).showAgentProgressIndicator).toBe(true);
	});

	it("shows the thinking indicator while a tool call row is visible", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					summary={createSummary("running", {
						latestHookActivity: createHookActivity("assistant_delta"),
					})}
					incomingMessage={{
						id: "assistant-1",
						role: "assistant",
						content: "Let me edit this file",
						createdAt: 2,
					}}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		expect(requireSnapshot(latestSnapshot).showAgentProgressIndicator).toBe(true);

		await act(async () => {
			root.render(
				<HookHarness
					summary={createSummary("running", {
						latestHookActivity: createHookActivity("tool_call"),
					})}
					incomingMessage={{
						id: "tool-1",
						role: "tool",
						content: "Tool: Edit",
						createdAt: 3,
						meta: {
							hookEventName: "tool_call_start",
							toolName: "Edit",
						},
					}}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		expect(requireSnapshot(latestSnapshot).showAgentProgressIndicator).toBe(true);
	});
});
