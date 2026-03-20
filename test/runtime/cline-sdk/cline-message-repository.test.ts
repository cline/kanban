import { describe, expect, it, vi } from "vitest";

import { createInMemoryClineMessageRepository } from "../../../src/cline-sdk/cline-message-repository.js";
import type { ClinePersistedTaskSessionSnapshot } from "../../../src/cline-sdk/cline-session-runtime.js";
import { createDefaultSummary, createMessage, type ClineTaskSessionEntry } from "../../../src/cline-sdk/cline-session-state.js";

function createPersistedSnapshot(
	messages: NonNullable<ClinePersistedTaskSessionSnapshot>["messages"],
): ClinePersistedTaskSessionSnapshot {
	return {
		record: {
			sessionId: "task-1-abc123",
			source: "core",
			status: "completed",
			startedAt: "2026-03-17T10:00:00.000Z",
			updatedAt: "2026-03-17T10:05:00.000Z",
			interactive: true,
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/repo",
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			isSubagent: false,
		},
		messages,
	};
}

function createEntry(taskId: string): ClineTaskSessionEntry {
	return {
		summary: createDefaultSummary(taskId),
		messages: [],
		activeAssistantMessageId: null,
		activeReasoningMessageId: null,
		toolMessageIdByToolCallId: new Map<string, string>(),
		toolInputByToolCallId: new Map<string, unknown>(),
	};
}

describe("InMemoryClineMessageRepository", () => {
	it("hydrates persisted SDK history into Kanban chat messages and caches the result", async () => {
		const repository = createInMemoryClineMessageRepository();
		const loadPersistedSession = vi.fn(async () =>
			createPersistedSnapshot([
				{
					role: "user",
					content: "Investigate startup",
				},
				{
					role: "assistant",
					content: [
						{
							type: "thinking",
							thinking: "Inspecting logs",
						},
						{
							type: "tool_use",
							id: "tool-1",
							name: "read_file",
							input: {
								path: "src/index.ts",
							},
						},
						{
							type: "text",
							text: "I found the issue.",
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: "console.log('ready')",
						},
					],
				},
			]),
		);

		const firstLoad = await repository.hydrateTaskMessages("task-1", loadPersistedSession);
		const secondLoad = await repository.hydrateTaskMessages("task-1", loadPersistedSession);

		expect(firstLoad.map((message) => ({ role: message.role, content: message.content }))).toEqual([
			{
				role: "user",
				content: "Investigate startup",
			},
			{
				role: "reasoning",
				content: "Inspecting logs",
			},
			{
				role: "tool",
				content: 'Tool: read_file\nInput:\n{\n  "path": "src/index.ts"\n}\nOutput:\nconsole.log(\'ready\')',
			},
			{
				role: "assistant",
				content: "I found the issue.",
			},
		]);
		expect(secondLoad).toEqual(firstLoad);
		expect(repository.listMessages("task-1")).toEqual(firstLoad);
		expect(loadPersistedSession).toHaveBeenCalledTimes(1);
	});

	it("prefers live in-memory task entries over persisted history hydration", async () => {
		const repository = createInMemoryClineMessageRepository();
		const entry = createEntry("task-1");
		entry.messages.push(createMessage("task-1", "assistant", "Live response"));
		repository.setTaskEntry("task-1", entry);
		const loadPersistedSession = vi.fn(async () =>
			createPersistedSnapshot([
				{
					role: "assistant",
					content: "Persisted response",
				},
			]),
		);

		const messages = await repository.hydrateTaskMessages("task-1", loadPersistedSession);

		expect(messages.map((message) => message.content)).toEqual(["Live response"]);
		expect(loadPersistedSession).not.toHaveBeenCalled();
	});
});
