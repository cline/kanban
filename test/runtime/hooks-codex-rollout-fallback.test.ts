import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveCodexRolloutFinalMessageForCwd } from "../../src/commands/hooks";

describe("resolveCodexRolloutFinalMessageForCwd", () => {
	it("returns the latest task_complete final message for the matching cwd", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "kanban-codex-rollout-"));
		const sessionsRoot = join(tempDir, "sessions");
		const taskCwd = "/tmp/kanban/task-1";

		try {
			const dateDir = join(sessionsRoot, "2026", "03", "29");
			await mkdir(dateDir, { recursive: true });

			await writeFile(
				join(dateDir, "rollout-2026-03-29T00-00-01-older.jsonl"),
				[
					JSON.stringify({
						type: "session_meta",
						payload: { cwd: "/tmp/other-task" },
					}),
					JSON.stringify({
						type: "event_msg",
						payload: { type: "task_complete", last_agent_message: "Ignore me" },
					}),
				].join("\n"),
				"utf8",
			);

			await writeFile(
				join(dateDir, "rollout-2026-03-29T00-00-02-newer.jsonl"),
				[
					JSON.stringify({
						type: "session_meta",
						payload: { cwd: taskCwd },
					}),
					JSON.stringify({
						type: "event_msg",
						payload: { type: "agent_message", phase: "final_answer", message: "Intermediate answer" },
					}),
					JSON.stringify({
						type: "event_msg",
						payload: { type: "task_complete", last_agent_message: "Final answer from task_complete" },
					}),
				].join("\n"),
				"utf8",
			);

			const resolved = await resolveCodexRolloutFinalMessageForCwd(taskCwd, sessionsRoot);
			expect(resolved).toBe("Final answer from task_complete");
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	it("falls back to final assistant response text when task_complete is absent", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "kanban-codex-rollout-"));
		const sessionsRoot = join(tempDir, "sessions");
		const taskCwd = "/tmp/kanban/task-2";

		try {
			const dateDir = join(sessionsRoot, "2026", "03", "29");
			await mkdir(dateDir, { recursive: true });
			await writeFile(
				join(dateDir, "rollout-2026-03-29T00-00-03-only-response.jsonl"),
				[
					JSON.stringify({
						type: "session_meta",
						payload: { cwd: taskCwd },
					}),
					JSON.stringify({
						type: "response_item",
						payload: {
							type: "message",
							role: "assistant",
							phase: "final_answer",
							content: [{ type: "output_text", text: "Response item final text" }],
						},
					}),
				].join("\n"),
				"utf8",
			);

			const resolved = await resolveCodexRolloutFinalMessageForCwd(taskCwd, sessionsRoot);
			expect(resolved).toBe("Response item final text");
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	it("resolves final message from large rollout files by scanning prefix and tail", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "kanban-codex-rollout-"));
		const sessionsRoot = join(tempDir, "sessions");
		const taskCwd = "/tmp/kanban/task-large";

		try {
			const dateDir = join(sessionsRoot, "2026", "03", "29");
			await mkdir(dateDir, { recursive: true });
			await writeFile(
				join(dateDir, "rollout-2026-03-29T00-00-04-large.jsonl"),
				[
					JSON.stringify({
						type: "session_meta",
						payload: { cwd: taskCwd },
					}),
					"x".repeat(7 * 1024 * 1024),
					JSON.stringify({
						type: "event_msg",
						payload: { type: "task_complete", last_agent_message: "Final answer from large file" },
					}),
				].join("\n"),
				"utf8",
			);

			const resolved = await resolveCodexRolloutFinalMessageForCwd(taskCwd, sessionsRoot);
			expect(resolved).toBe("Final answer from large file");
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});
