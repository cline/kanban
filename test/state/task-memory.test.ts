import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { RuntimeBoardCard, RuntimeBoardData, RuntimeTaskSessionSummary } from "../../src/core/api-contract";
import { readTaskMemoryIndex, synchronizeTaskMemories } from "../../src/state/task-memory";
import { createTempDir } from "../utilities/temp-dir";

async function withTemporaryHome<T>(run: (home: string) => Promise<T>): Promise<T> {
	const { path: tempHome, cleanup } = createTempDir("kanban-task-memory-");
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	try {
		return await run(tempHome);
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = previousUserProfile;
		cleanup();
	}
}

function createCard(id: string, title: string, summary: string): RuntimeBoardCard {
	return {
		id,
		title,
		prompt: title,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 2,
		summary: { content: summary, source: "automatic", updatedAt: 3 },
	};
}

function createBoard(cards: RuntimeBoardCard[]): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
	};
}

describe("task-memory", () => {
	it("ignores persisted detail paths outside the task-memory directory", async () => {
		await withTemporaryHome(async (home) => {
			const taskMemoryRoot = join(home, ".cline", "kanban", "workspaces", "workspace-1", "task-memory");
			const escapedPath = join(home, "escaped.md");
			await mkdir(taskMemoryRoot, { recursive: true });
			await writeFile(
				join(taskMemoryRoot, "manifest.json"),
				JSON.stringify({
					version: 1,
					entries: {
						"task-1": {
							taskId: "task-1",
							title: "Persisted task",
							status: "completed",
							summary: "Persisted result",
							detailPath: escapedPath,
							updatedAt: 1,
						},
					},
				}),
				"utf8",
			);

			await synchronizeTaskMemories({ workspaceId: "workspace-1", board: createBoard([]), sessions: {} });

			const index = await readTaskMemoryIndex("workspace-1");
			expect(index).not.toContain(escapedPath);
			await expect(readFile(escapedPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
		});
	});

	it("indexes active summaries and preserves a failed task after batch deletion", async () => {
		await withTemporaryHome(async () => {
			const activeCard = createCard("active-1", "Current approach", "Use the parser already in the SDK.");
			const failedCard = createCard("failed-1", "Rejected approach", "Tried polling; it leaked child processes.");
			const failedSession = {
				taskId: failedCard.id,
				state: "failed",
				reviewReason: "error",
			} as RuntimeTaskSessionSummary;

			await synchronizeTaskMemories({
				workspaceId: "workspace-1",
				board: createBoard([activeCard]),
				sessions: { [failedCard.id]: failedSession },
				archivedTasks: [{ card: failedCard, columnId: "trash" }],
			});

			const index = await readTaskMemoryIndex("workspace-1");
			expect(index).toContain("Current approach** [active]");
			expect(index).toContain("Rejected approach** [failed]");
			expect(index).toContain("Tried polling; it leaked child processes.");

			const detailPath = index.match(/Rejected approach[\s\S]*?Detail: (.*\.md)/)?.[1];
			if (!detailPath) {
				throw new Error("Missing failed task detail path");
			}
			const detail = await readFile(detailPath, "utf8");
			expect(detail).toContain("Outcome: failed");
			expect(detail).toContain("Tried polling; it leaked child processes.");
		});
	});

	it("uses distinct detail files and marks interrupted tasks as stopped", async () => {
		await withTemporaryHome(async () => {
			const interruptedCard = createCard("task/a", "Interrupted approach", "Stopped before completion.");
			const otherCard = createCard("task_a", "Other approach", "Completed separate research.");

			await synchronizeTaskMemories({
				workspaceId: "workspace-1",
				board: createBoard([interruptedCard, otherCard]),
				sessions: {
					[interruptedCard.id]: {
						taskId: interruptedCard.id,
						state: "interrupted",
						reviewReason: "interrupted",
					} as RuntimeTaskSessionSummary,
				},
			});

			const index = await readTaskMemoryIndex("workspace-1");
			expect(index).toContain("Interrupted approach** [stopped]");
			const detailPaths = Array.from(index.matchAll(/Detail: (.*\.md)/g), (match) => match[1]);
			expect(new Set(detailPaths).size).toBe(2);
		});
	});
});
