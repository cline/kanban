import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { mapPiSessionEntry, resolvePiExitReviewActivityFromSessionDir } from "../../../src/terminal/pi-session-log";

function sessionLine(id: string, parentId: string | null, message: Record<string, unknown>): string {
	return JSON.stringify({
		type: "message",
		id,
		parentId,
		timestamp: "2026-08-18T12:00:00.000Z",
		message,
	});
}

describe("mapPiSessionEntry", () => {
	it("maps a user message to in-progress", () => {
		expect(
			mapPiSessionEntry(
				sessionLine("u1", null, {
					role: "user",
					content: "Please fix the bug",
					timestamp: 1,
				}),
			),
		).toEqual([
			{
				event: "to_in_progress",
				metadata: {
					source: "pi",
					hookEventName: "user_message",
					activityText: "Working on task",
				},
			},
		]);
	});

	it("maps tool calls, tool results, and bash execution to activity", () => {
		expect(
			mapPiSessionEntry(
				sessionLine("a1", "u1", {
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: "call_1",
							name: "read",
							arguments: { path: "src/app.ts" },
						},
					],
					stopReason: "toolUse",
				}),
			),
		).toEqual([
			{
				event: "activity",
				metadata: {
					source: "pi",
					hookEventName: "tool_call",
					toolName: "read",
					activityText: "Calling read: src/app.ts",
				},
			},
		]);

		expect(
			mapPiSessionEntry(
				sessionLine("t1", "a1", {
					role: "toolResult",
					toolName: "read",
					content: [{ type: "text", text: "export const x = 1;" }],
					isError: false,
				}),
			),
		).toEqual([
			{
				event: "activity",
				metadata: {
					source: "pi",
					hookEventName: "tool_result",
					toolName: "read",
					activityText: "Completed read: export const x = 1;",
				},
			},
		]);

		expect(
			mapPiSessionEntry(
				sessionLine("b1", "t1", {
					role: "bashExecution",
					command: "ls",
					output: "app.ts",
					exitCode: 0,
					cancelled: false,
					truncated: false,
				}),
			),
		).toEqual([
			{
				event: "activity",
				metadata: {
					source: "pi",
					hookEventName: "bash_execution",
					toolName: "bash",
					activityText: "Completed bash: ls",
				},
			},
		]);
	});

	it("maps a stopReason=stop assistant turn without tools to review", () => {
		expect(
			mapPiSessionEntry(
				sessionLine("a2", "u1", {
					role: "assistant",
					content: [{ type: "text", text: "All done from Pi" }],
					stopReason: "stop",
				}),
			),
		).toEqual([
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

	it("maps a stopReason=stop turn without text to review", () => {
		expect(
			mapPiSessionEntry(
				sessionLine("a-empty", "u1", {
					role: "assistant",
					content: [],
					stopReason: "stop",
				}),
			),
		).toEqual([
			{
				event: "to_review",
				metadata: {
					source: "pi",
					hookEventName: "assistant_message",
					activityText: "Waiting for review",
				},
			},
		]);
	});

	it("does not treat toolUse, aborted, or compaction entries as review", () => {
		expect(
			mapPiSessionEntry(
				sessionLine("a3", "u1", {
					role: "assistant",
					content: [
						{ type: "text", text: "Let me look" },
						{ type: "toolCall", id: "c2", name: "bash", arguments: { command: "pwd" } },
					],
					stopReason: "toolUse",
				}),
			).some((mapped) => mapped.event === "to_review"),
		).toBe(false);

		expect(
			mapPiSessionEntry(
				sessionLine("a4", "u1", {
					role: "assistant",
					content: [{ type: "text", text: "Stopped early" }],
					stopReason: "aborted",
				}),
			),
		).toEqual([]);

		expect(
			mapPiSessionEntry(JSON.stringify({ type: "compaction", id: "c1", parentId: "a4", summary: "old" })),
		).toEqual([]);
	});
});

describe("resolvePiExitReviewActivityFromSessionDir", () => {
	it("walks the active leaf path so abandoned /tree branches do not win", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "kanban-pi-session-"));
		try {
			await writeFile(
				join(tempDir, "session.jsonl"),
				[
					JSON.stringify({ type: "session", version: 3, id: "sess", timestamp: "2026-08-18T12:00:00.000Z" }),
					sessionLine("u1", null, { role: "user", content: "first" }),
					sessionLine("a1", "u1", {
						role: "assistant",
						content: [{ type: "text", text: "Abandoned final" }],
						stopReason: "stop",
					}),
					JSON.stringify({
						type: "branch_summary",
						id: "bs1",
						parentId: "u1",
						fromId: "a1",
						summary: "tried approach A",
					}),
					sessionLine("u2", "u1", { role: "user", content: "try again" }),
					sessionLine("a2", "u2", {
						role: "assistant",
						content: [{ type: "text", text: "Active final" }],
						stopReason: "stop",
					}),
					"",
				].join("\n"),
				"utf8",
			);

			await expect(resolvePiExitReviewActivityFromSessionDir(tempDir)).resolves.toEqual({
				source: "pi",
				hookEventName: "assistant_message",
				finalMessage: "Active final",
				activityText: "Final: Active final",
			});
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	it("falls back to a generic review payload on clean exit without a final answer", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "kanban-pi-session-"));
		try {
			await writeFile(
				join(tempDir, "session.jsonl"),
				[
					JSON.stringify({ type: "session", version: 3, id: "sess", timestamp: "2026-08-18T12:00:00.000Z" }),
					sessionLine("u1", null, { role: "user", content: "hello" }),
					"",
				].join("\n"),
				"utf8",
			);

			await expect(resolvePiExitReviewActivityFromSessionDir(tempDir)).resolves.toEqual({
				source: "pi",
				hookEventName: "session_exit",
				activityText: "Waiting for review",
			});
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});
