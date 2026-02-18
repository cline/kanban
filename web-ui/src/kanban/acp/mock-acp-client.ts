import type { AcpClient, AcpTurnCallbacks, AcpTurnController, AcpTurnRequest } from "@/kanban/acp/types";
import type { ChatTimelineEntry, ChatToolCall } from "@/kanban/chat/types";

function normalizeTaskKeyword(text: string): string {
	const cleaned = text.replace(/[^a-zA-Z0-9\s]/g, " ").trim();
	const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 6);
	return words.length > 0 ? words.join(" ").toLowerCase() : "task workflow";
}

function inferFilePaths(input: string): string[] {
	const matches = input.match(/[A-Za-z0-9_./-]+\.(ts|tsx|js|jsx|json|md|css|yml|yaml)/g) ?? [];
	if (matches.length > 0) {
		return Array.from(new Set(matches)).slice(0, 2);
	}

	const lowered = input.toLowerCase();
	if (lowered.includes("chat")) {
		return ["src/kanban/components/detail-panels/agent-chat-panel.tsx", "src/kanban/chat/hooks/use-task-chat-sessions.ts"];
	}
	if (lowered.includes("diff")) {
		return ["src/kanban/components/detail-panels/diff-viewer-panel.tsx", "src/kanban/chat/utils/session-artifacts.ts"];
	}
	if (lowered.includes("file")) {
		return ["src/kanban/components/detail-panels/file-tree-panel.tsx", "src/kanban/chat/utils/session-artifacts.ts"];
	}

	return ["src/kanban/components/kanban-board.tsx", "src/kanban/state/board-state.ts"];
}

function createToolCallMessage(id: string, timestamp: number, toolCall: ChatToolCall): ChatTimelineEntry {
	return {
		type: "tool_call",
		id,
		timestamp,
		toolCall,
	};
}

function scheduleWithTracking(
	timeouts: ReturnType<typeof setTimeout>[],
	delayMs: number,
	fn: () => void,
): void {
	timeouts.push(setTimeout(fn, delayMs));
}

function runMockTurn(request: AcpTurnRequest, callbacks: AcpTurnCallbacks): AcpTurnController {
	const timeouts: ReturnType<typeof setTimeout>[] = [];
	let completed = false;
	let resolveDone: () => void = () => undefined;
	const done = new Promise<void>((resolve) => {
		resolveDone = resolve;
	});

	const keyword = normalizeTaskKeyword(`${request.taskTitle} ${request.prompt}`);
	const filePaths = inferFilePaths(`${request.prompt}\n${request.taskDescription}\n${request.taskTitle}`);
	const primaryPath = filePaths[0] ?? "src/kanban/components/kanban-board.tsx";
	const secondaryPath = filePaths[1] ?? "src/kanban/state/board-state.ts";
	const base = Date.now();
	const turnId = `${request.taskId}-${base}`;

	const readToolId = `${turnId}-read`;
	const editToolId = `${turnId}-edit-primary`;
	const testToolId = `${turnId}-test`;
	const followupEditToolId = `${turnId}-edit-secondary`;

	callbacks.onStatus("thinking");
	callbacks.onEntry({
		type: "user_message",
		id: `${turnId}-user`,
		timestamp: Date.now(),
		text: request.prompt,
	});
	callbacks.onAvailableCommands?.([
		{ name: "plan", description: "Create or update a plan for this task", input: { hint: "what to plan" } },
		{ name: "review", description: "Review changes and risks for this task" },
		{ name: "test", description: "Run project tests for this task" },
		{ name: "search", description: "Search codebase for relevant files", input: { hint: "query" } },
	]);

	scheduleWithTracking(timeouts, 200, () => {
		callbacks.onEntry({
			type: "agent_thought",
			id: `${turnId}-thought`,
			timestamp: Date.now(),
			text: `Understanding task scope for ${keyword}. Gathering context from likely files before editing.`,
			isStreaming: true,
		});
	});

	scheduleWithTracking(timeouts, 1000, () => {
		callbacks.onEntry({
			type: "agent_thought",
			id: `${turnId}-thought`,
			timestamp: Date.now(),
			text: `Understanding task scope for ${keyword}.\n\nPlan:\n1. Inspect existing flow\n2. Apply focused edits\n3. Validate with tests`,
			isStreaming: false,
		});
	});

	scheduleWithTracking(timeouts, 1200, () => {
		callbacks.onEntry({
			type: "plan",
			id: `${turnId}-plan`,
			timestamp: Date.now(),
			entries: [
				{ content: `Read ${primaryPath}`, status: "completed", priority: "high" },
				{ content: `Implement ${keyword}`, status: "in_progress", priority: "high" },
				{ content: "Run validation command", status: "pending", priority: "medium" },
			],
		});
	});

	scheduleWithTracking(timeouts, 1400, () => {
		callbacks.onStatus("tool_running");
		callbacks.onEntry(
			createToolCallMessage(`${turnId}-tool-read`, base + 1400, {
				toolCallId: readToolId,
				title: `Reading ${primaryPath}`,
				kind: "read",
				status: "completed",
				locations: [{ path: primaryPath }],
			}),
		);
	});

	scheduleWithTracking(timeouts, 1800, () => {
		callbacks.onEntry(
			createToolCallMessage(`${turnId}-tool-edit-primary`, base + 1800, {
				toolCallId: editToolId,
				title: `Editing ${primaryPath}`,
				kind: "edit",
				status: "in_progress",
				locations: [{ path: primaryPath, line: 1 }],
			}),
		);
	});

	scheduleWithTracking(timeouts, 2600, () => {
		callbacks.onEntry(
			createToolCallMessage(`${turnId}-tool-edit-primary`, base + 2600, {
				toolCallId: editToolId,
				title: `Editing ${primaryPath}`,
				kind: "edit",
				status: "completed",
				locations: [{ path: primaryPath, line: 1 }],
				content: [
					{
						type: "diff",
						path: primaryPath,
						oldText: "const taskState = \"pending\";",
						newText: "const taskState = \"running\";",
					},
				],
			}),
		);
	});

	scheduleWithTracking(timeouts, 3000, () => {
		callbacks.onEntry(
			createToolCallMessage(`${turnId}-tool-edit-secondary`, base + 3000, {
				toolCallId: followupEditToolId,
				title: `Editing ${secondaryPath}`,
				kind: "edit",
				status: "completed",
				locations: [{ path: secondaryPath, line: 1 }],
				content: [
					{
						type: "diff",
						path: secondaryPath,
						oldText: "return previousState;",
						newText: "return nextState;",
					},
				],
			}),
		);
	});

	scheduleWithTracking(timeouts, 3400, () => {
		callbacks.onEntry(
			createToolCallMessage(`${turnId}-tool-test`, base + 3400, {
				toolCallId: testToolId,
				title: "Running npm run test",
				kind: "execute",
				status: "completed",
				content: [
					{
						type: "content",
						content: {
							type: "text",
							text: "Tests passed for updated task workflow.",
						},
					},
				],
			}),
		);
	});

	scheduleWithTracking(timeouts, 3700, () => {
		callbacks.onStatus("thinking");
		callbacks.onEntry({
			type: "agent_message",
			id: `${turnId}-agent-summary`,
			timestamp: Date.now(),
			text: `Finished ${keyword}. Updated ${primaryPath} and ${secondaryPath}, then validated the result. Ready for review.`,
			isStreaming: false,
		});
	});

	scheduleWithTracking(timeouts, 4100, () => {
		if (completed) {
			return;
		}
		completed = true;
		callbacks.onStatus("idle");
		callbacks.onComplete();
		resolveDone();
	});

	const cancel = () => {
		if (completed) {
			return;
		}
		completed = true;
		for (const timeout of timeouts) {
			clearTimeout(timeout);
		}
		resolveDone();
	};

	return { cancel, done };
}

export class MockAcpClient implements AcpClient {
	runTurn(request: AcpTurnRequest, callbacks: AcpTurnCallbacks): AcpTurnController {
		return runMockTurn(request, callbacks);
	}
}
