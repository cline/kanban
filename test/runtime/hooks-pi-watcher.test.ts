import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { startPiSessionWatcher } from "../../src/commands/hook-events/pi-hooks";

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
						stopReason: "stop",
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
			20,
		);

		try {
			await writeFile(
				logPath,
				[
					createPiSessionEntry({ role: "user", content: "fix it" }),
					createPiSessionEntry({
						role: "assistant",
						content: [{ type: "toolCall", id: "c1", name: "read", arguments: { path: "a.ts" } }],
						stopReason: "toolUse",
					}),
					createPiSessionEntry({
						role: "toolResult",
						toolName: "read",
						content: [{ type: "text", text: "ok" }],
						isError: false,
					}),
					createPiSessionEntry({
						role: "assistant",
						content: [{ type: "text", text: "Done" }],
						stopReason: "stop",
					}),
				].join(""),
				"utf8",
			);

			await new Promise((resolve) => setTimeout(resolve, 80));
			await stopWatcher();
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}

		expect(events.map((entry) => entry.event)).toEqual(["to_in_progress", "activity", "activity", "to_review"]);
	});
});
