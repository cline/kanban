import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { startPiSessionWatcher } from "../../src/commands/hooks";

let piSessionEntryCounter = 0;

function createPiSessionEntry(message: Record<string, unknown>, includeTrailingNewline = true): string {
	piSessionEntryCounter += 1;
	const line = JSON.stringify({
		type: "message",
		id: `entry-${piSessionEntryCounter}`,
		parentId: null,
		timestamp: new Date().toISOString(),
		message,
	});
	return includeTrailingNewline ? `${line}\n` : line;
}

describe("startPiSessionWatcher", () => {
	it("flushes a late final assistant message to review metadata on stop", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "kanban-pi-watcher-"));
		const events: Array<{ event: string; metadata?: Record<string, unknown> }> = [];
		const stopWatcher = await startPiSessionWatcher(
			tempDir,
			(event, metadata) => {
				events.push({ event, metadata: metadata as Record<string, unknown> | undefined });
			},
			60_000,
		);

		try {
			await writeFile(
				join(tempDir, "session.jsonl"),
				createPiSessionEntry(
					{
						role: "assistant",
						content: [{ type: "text", text: "All done from Pi" }],
					},
					false,
				),
				"utf8",
			);

			await stopWatcher();
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}

		expect(events).toEqual([
			{
				event: "to_review",
				metadata: {
					source: "pi",
					hookEventName: "assistant_message",
					finalMessage: "All done from Pi",
					activityText: "Final: All done from Pi",
				},
			},
		]);
	});

	it("maps user, tool call, tool result, and final assistant entries", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "kanban-pi-watcher-"));
		const logPath = join(tempDir, "session.jsonl");
		const events: Array<{ event: string; metadata?: Record<string, unknown> }> = [];
		const stopWatcher = await startPiSessionWatcher(
			tempDir,
			(event, metadata) => {
				events.push({ event, metadata: metadata as Record<string, unknown> | undefined });
			},
			60_000,
		);

		try {
			await new Promise((resolve) => setTimeout(resolve, 20));
			await writeFile(
				logPath,
				[
					createPiSessionEntry({
						role: "user",
						content: [{ type: "text", text: "inspect the repo" }],
					}),
					createPiSessionEntry({
						role: "assistant",
						content: [
							{
								type: "toolCall",
								id: "call-1",
								name: "bash",
								arguments: { command: "pwd" },
							},
						],
					}),
					createPiSessionEntry({
						role: "toolResult",
						toolName: "bash",
						content: [{ type: "text", text: "/tmp/task" }],
						isError: false,
					}),
					createPiSessionEntry(
						{
							role: "assistant",
							content: [{ type: "text", text: "Finished the repo inspection" }],
						},
						false,
					),
				].join(""),
				"utf8",
			);

			await stopWatcher();
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}

		expect(events).toEqual([
			{
				event: "to_in_progress",
				metadata: {
					source: "pi",
					hookEventName: "user_message",
					activityText: "Working on task",
				},
			},
			{
				event: "activity",
				metadata: {
					source: "pi",
					hookEventName: "tool_call",
					toolName: "bash",
					activityText: "Calling bash: pwd",
				},
			},
			{
				event: "activity",
				metadata: {
					source: "pi",
					hookEventName: "tool_result",
					toolName: "bash",
					activityText: "Completed bash: /tmp/task",
					finalMessage: "/tmp/task",
				},
			},
			{
				event: "to_review",
				metadata: {
					source: "pi",
					hookEventName: "assistant_message",
					finalMessage: "Finished the repo inspection",
					activityText: "Final: Finished the repo inspection",
				},
			},
		]);
	});

	it("maps an assistant message with tool calls and final-answer text to both activity and review", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "kanban-pi-watcher-"));
		const logPath = join(tempDir, "session.jsonl");
		const events: Array<{ event: string; metadata?: Record<string, unknown> }> = [];
		const stopWatcher = await startPiSessionWatcher(
			tempDir,
			(event, metadata) => {
				events.push({ event, metadata: metadata as Record<string, unknown> | undefined });
			},
			60_000,
		);

		try {
			await writeFile(
				logPath,
				createPiSessionEntry(
					{
						role: "assistant",
						content: [
							{
								type: "toolCall",
								id: "call-1",
								name: "read",
								arguments: { path: "src/index.ts" },
							},
							{
								type: "text",
								text: "All done after reading the file",
								textSignature: JSON.stringify({ v: 1, phase: "final_answer" }),
							},
						],
					},
					false,
				),
				"utf8",
			);
			await stopWatcher();
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}

		expect(events).toEqual([
			{
				event: "activity",
				metadata: {
					source: "pi",
					hookEventName: "tool_call",
					toolName: "read",
					activityText: "Calling read: src/index.ts",
				},
			},
			{
				event: "to_review",
				metadata: {
					source: "pi",
					hookEventName: "assistant_message",
					finalMessage: "All done after reading the file",
					activityText: "Final: All done after reading the file",
				},
			},
		]);
	});

	it("processes a new session log even if it appears immediately after watcher start", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "kanban-pi-watcher-"));
		const logPath = join(tempDir, "new-session.jsonl");
		const events: Array<{ event: string; metadata?: Record<string, unknown> }> = [];
		const stopWatcher = await startPiSessionWatcher(
			tempDir,
			(event, metadata) => {
				events.push({ event, metadata: metadata as Record<string, unknown> | undefined });
			},
			60_000,
		);

		try {
			await writeFile(
				logPath,
				`${createPiSessionEntry({ role: "assistant", content: [{ type: "text", text: "Immediate Pi response" }] })}`,
				"utf8",
			);
			await stopWatcher();
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}

		expect(events).toEqual([
			{
				event: "to_review",
				metadata: {
					source: "pi",
					hookEventName: "assistant_message",
					finalMessage: "Immediate Pi response",
					activityText: "Final: Immediate Pi response",
				},
			},
		]);
	});

	it("ignores duplicate replay of the same session entry ids", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "kanban-pi-watcher-"));
		const logPath = join(tempDir, "session.jsonl");
		const events: Array<{ event: string; metadata?: Record<string, unknown> }> = [];
		const stopWatcher = await startPiSessionWatcher(
			tempDir,
			(event, metadata) => {
				events.push({ event, metadata: metadata as Record<string, unknown> | undefined });
			},
			5,
		);

		try {
			await new Promise((resolve) => setTimeout(resolve, 20));
			await writeFile(
				logPath,
				`${JSON.stringify({
					type: "message",
					id: "duplicate-entry",
					parentId: null,
					timestamp: new Date().toISOString(),
					message: {
						role: "assistant",
						content: [
							{
								type: "text",
								text: "Only once",
								textSignature: JSON.stringify({ v: 1, phase: "final_answer" }),
							},
						],
					},
				})}\n`,
				"utf8",
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
			await writeFile(
				logPath,
				`${JSON.stringify({
					type: "message",
					id: "duplicate-entry",
					parentId: null,
					timestamp: new Date().toISOString(),
					message: {
						role: "assistant",
						content: [
							{
								type: "text",
								text: "Only once",
								textSignature: JSON.stringify({ v: 1, phase: "final_answer" }),
							},
						],
					},
				})}\n`,
				"utf8",
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
			await stopWatcher();
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}

		expect(events).toEqual([
			{
				event: "to_review",
				metadata: {
					source: "pi",
					hookEventName: "assistant_message",
					finalMessage: "Only once",
					activityText: "Final: Only once",
				},
			},
		]);
	});

	it("ignores backlog from an older session log when the watcher starts", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "kanban-pi-watcher-"));
		const logPath = join(tempDir, "existing-session.jsonl");
		const events: Array<{ event: string; metadata?: Record<string, unknown> }> = [];

		try {
			await writeFile(
				logPath,
				`${createPiSessionEntry({ role: "assistant", content: [{ type: "text", text: "Stale final message" }] })}`,
				"utf8",
			);
			await new Promise((resolve) => setTimeout(resolve, 10));
			const stopWatcher = await startPiSessionWatcher(
				tempDir,
				(event, metadata) => {
					events.push({ event, metadata: metadata as Record<string, unknown> | undefined });
				},
				60_000,
			);
			await stopWatcher();
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}

		expect(events).toEqual([]);
	});
});
