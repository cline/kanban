import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { startCodexSessionWatcher } from "../../src/commands/hooks";

function createCodexLogLine(message: Record<string, unknown>, includeTrailingNewline = true): string {
	const line = JSON.stringify({
		dir: "to_tui",
		kind: "codex_event",
		msg: message,
	});
	return includeTrailingNewline ? `${line}\n` : line;
}

function createCodexOpLine(payload: Record<string, unknown>, includeTrailingNewline = true): string {
	const line = JSON.stringify({
		dir: "from_tui",
		kind: "op",
		payload,
	});
	return includeTrailingNewline ? `${line}\n` : line;
}

function createRolloutLine(line: Record<string, unknown>, includeTrailingNewline = true): string {
	const encoded = JSON.stringify(line);
	return includeTrailingNewline ? `${encoded}\n` : encoded;
}

describe("startCodexSessionWatcher", () => {
	it("flushes completion events on stop even when the log file appears late", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "kanban-codex-watcher-"));
		const logPath = join(tempDir, "session.jsonl");
		const events: Array<{ event: string; metadata?: Record<string, unknown> }> = [];
		const stopWatcher = await startCodexSessionWatcher(
			logPath,
			(mapped) => {
				events.push(mapped as { event: string; metadata?: Record<string, unknown> });
			},
			60_000,
		);

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

	it("parses user_turn operations from modern codex logs", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "kanban-codex-watcher-"));
		const logPath = join(tempDir, "session.jsonl");
		const events: Array<{ event: string; metadata?: Record<string, unknown> }> = [];
		const stopWatcher = await startCodexSessionWatcher(
			logPath,
			(mapped) => {
				events.push(mapped as { event: string; metadata?: Record<string, unknown> });
			},
			60_000,
		);

		try {
			await writeFile(
				logPath,
				createCodexOpLine(
					{
						type: "user_turn",
						items: [{ type: "text", text: "continue" }],
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
				event: "to_in_progress",
				metadata: {
					source: "codex",
					hookEventName: "user_turn",
					activityText: "Resumed after user input",
				},
			},
		]);
	});

	it("emits in-progress activity from rollout events when tui logs are low-signal", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "kanban-codex-watcher-"));
		const logPath = join(tempDir, "session.jsonl");
		const sessionsRoot = join(tempDir, "sessions");
		const taskCwd = "/tmp/kanban/task-rollout-live";
		const rolloutDir = join(sessionsRoot, "2026", "03", "29");
		const rolloutPath = join(rolloutDir, "rollout-2026-03-29T00-00-02-live.jsonl");
		const events: Array<{ event: string; metadata?: Record<string, unknown> }> = [];
		const stopWatcher = await startCodexSessionWatcher(
			logPath,
			(mapped) => {
				events.push(mapped as { event: string; metadata?: Record<string, unknown> });
			},
			60_000,
			{
				cwd: taskCwd,
				sessionsRoot,
				rolloutPollIntervalMs: 0,
			},
		);

		try {
			await mkdir(rolloutDir, { recursive: true });
			await writeFile(
				rolloutPath,
				[
					createRolloutLine({
						type: "session_meta",
						payload: { cwd: taskCwd },
					}),
					createRolloutLine(
						{
							type: "event_msg",
							payload: {
								type: "exec_command_end",
								call_id: "call-live-1",
								command: ["/bin/zsh", "-lc", "npm run typecheck"],
								status: "completed",
							},
						},
						false,
					),
				].join(""),
				"utf8",
			);
			await writeFile(
				logPath,
				createCodexOpLine(
					{
						type: "user_turn",
						items: [{ type: "text", text: "continue" }],
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
				event: "to_in_progress",
				metadata: {
					source: "codex",
					hookEventName: "user_turn",
					activityText: "Resumed after user input",
				},
			},
			{
				event: "activity",
				metadata: {
					source: "codex",
					hookEventName: "exec_command_end",
					activityText: "Command finished: npm run typecheck",
				},
			},
		]);
	});

	it("emits review final metadata from rollout task_complete when available", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "kanban-codex-watcher-"));
		const logPath = join(tempDir, "session.jsonl");
		const sessionsRoot = join(tempDir, "sessions");
		const taskCwd = "/tmp/kanban/task-rollout-final";
		const rolloutDir = join(sessionsRoot, "2026", "03", "29");
		const rolloutPath = join(rolloutDir, "rollout-2026-03-29T00-00-03-final.jsonl");
		const events: Array<{ event: string; metadata?: Record<string, unknown> }> = [];
		const stopWatcher = await startCodexSessionWatcher(
			logPath,
			(mapped) => {
				events.push(mapped as { event: string; metadata?: Record<string, unknown> });
			},
			60_000,
			{
				cwd: taskCwd,
				sessionsRoot,
				rolloutPollIntervalMs: 0,
			},
		);

		try {
			await mkdir(rolloutDir, { recursive: true });
			await writeFile(
				rolloutPath,
				[
					createRolloutLine({
						type: "session_meta",
						payload: { cwd: taskCwd },
					}),
					createRolloutLine(
						{
							type: "event_msg",
							payload: {
								type: "task_complete",
								last_agent_message: "Final answer from rollout",
							},
						},
						false,
					),
				].join(""),
				"utf8",
			);
			await writeFile(
				logPath,
				createCodexOpLine(
					{
						type: "user_turn",
						items: [{ type: "text", text: "continue" }],
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
				event: "to_in_progress",
				metadata: {
					source: "codex",
					hookEventName: "user_turn",
					activityText: "Resumed after user input",
				},
			},
			{
				event: "to_review",
				metadata: {
					source: "codex",
					hookEventName: "task_complete",
					activityText: "Final: Final answer from rollout",
					finalMessage: "Final answer from rollout",
				},
			},
		]);
	});
});
