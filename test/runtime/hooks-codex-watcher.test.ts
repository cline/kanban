import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	startCodexSessionWatcher,
	type CodexMappedHookEvent,
} from "../../src/commands/hooks.js";

function createCodexLogLine(message: Record<string, unknown>, includeTrailingNewline = true): string {
	const line = JSON.stringify({
		dir: "to_tui",
		kind: "codex_event",
		msg: message,
	});
	return includeTrailingNewline ? `${line}\n` : line;
}

describe("startCodexSessionWatcher", () => {
	it("flushes completion events on stop even when the log file appears late", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "kanban-codex-watcher-"));
		const logPath = join(tempDir, "session.jsonl");
		const events: CodexMappedHookEvent[] = [];
		const stopWatcher = await startCodexSessionWatcher(logPath, (mapped) => {
			events.push(mapped);
		}, 60_000);

		try {
			await writeFile(
				logPath,
				createCodexLogLine(
					{
						type: "task_complete",
						last_agent_message: "Root complete",
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
					source: "codex",
					hookEventName: "task_complete",
					activityText: "Final: Root complete",
					finalMessage: "Root complete",
				},
			},
		]);
	});
});
