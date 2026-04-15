import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceStateWatcher } from "../../src/server/workspace-state-watcher";

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Poll interval in the watcher is 2 000 ms. We wait slightly longer
// to ensure at least one poll cycle has fired.
const POLL_WAIT_MS = 2_500;

function createMetaJson(revision: number): string {
	return JSON.stringify({ revision, updatedAt: Date.now() });
}

describe("WorkspaceStateWatcher", () => {
	let tempDir: string;
	let metaPath: string;
	const workspaceId = "test-workspace";
	const workspacePath = "/fake/repo";

	beforeEach(async () => {
		tempDir = join(tmpdir(), `watcher-test-${randomUUID()}`);
		await mkdir(tempDir, { recursive: true });
		metaPath = join(tempDir, "meta.json");
		await writeFile(metaPath, createMetaJson(1));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("broadcasts when meta.json is modified externally", async () => {
		const broadcastMock = vi.fn().mockResolvedValue(undefined);
		const watcher = createWorkspaceStateWatcher({
			broadcastRuntimeWorkspaceStateUpdated: broadcastMock,
		});

		try {
			watcher.watch(workspaceId, workspacePath, tempDir);

			// Simulate external write
			await writeFile(metaPath, createMetaJson(2));

			await delay(POLL_WAIT_MS);

			expect(broadcastMock).toHaveBeenCalledWith(workspaceId, workspacePath);
		} finally {
			watcher.close();
		}
	});

	it("broadcasts when meta.json is created after watcher starts", async () => {
		// Start with a directory that has NO meta.json yet
		const emptyDir = join(tmpdir(), `watcher-create-test-${randomUUID()}`);
		await mkdir(emptyDir, { recursive: true });

		const broadcastMock = vi.fn().mockResolvedValue(undefined);
		const watcher = createWorkspaceStateWatcher({
			broadcastRuntimeWorkspaceStateUpdated: broadcastMock,
		});

		try {
			watcher.watch(workspaceId, workspacePath, emptyDir);

			// Another runtime creates meta.json
			await writeFile(join(emptyDir, "meta.json"), createMetaJson(1));

			await delay(POLL_WAIT_MS);

			expect(broadcastMock).toHaveBeenCalledWith(workspaceId, workspacePath);
		} finally {
			watcher.close();
		}
	});

	it("creates the state directory if it does not exist", () => {
		const nonExistentDir = join(tmpdir(), `watcher-mkdir-test-${randomUUID()}`, "nested");
		const broadcastMock = vi.fn();
		const watcher = createWorkspaceStateWatcher({
			broadcastRuntimeWorkspaceStateUpdated: broadcastMock,
		});

		try {
			// Should not throw — watcher creates the directory
			watcher.watch(workspaceId, workspacePath, nonExistentDir);
		} finally {
			watcher.close();
		}
	});

	it("suppresses broadcast after markSelfWrite", async () => {
		const broadcastMock = vi.fn().mockResolvedValue(undefined);
		const watcher = createWorkspaceStateWatcher({
			broadcastRuntimeWorkspaceStateUpdated: broadcastMock,
		});

		try {
			watcher.watch(workspaceId, workspacePath, tempDir);

			// Mark self-write, then modify file
			watcher.markSelfWrite(workspaceId);
			await writeFile(metaPath, createMetaJson(2));

			await delay(POLL_WAIT_MS);

			expect(broadcastMock).not.toHaveBeenCalled();
		} finally {
			watcher.close();
		}
	});

	it("ignores duplicate watch calls for same workspaceId", () => {
		const broadcastMock = vi.fn();
		const watcher = createWorkspaceStateWatcher({
			broadcastRuntimeWorkspaceStateUpdated: broadcastMock,
		});

		try {
			watcher.watch(workspaceId, workspacePath, tempDir);
			// Should not throw or create a second watcher
			watcher.watch(workspaceId, workspacePath, tempDir);
		} finally {
			watcher.close();
		}
	});

	it("unwatch stops broadcasting for that workspace", async () => {
		const broadcastMock = vi.fn().mockResolvedValue(undefined);
		const watcher = createWorkspaceStateWatcher({
			broadcastRuntimeWorkspaceStateUpdated: broadcastMock,
		});

		try {
			watcher.watch(workspaceId, workspacePath, tempDir);
			watcher.unwatch(workspaceId);

			await writeFile(metaPath, createMetaJson(2));
			await delay(POLL_WAIT_MS);

			expect(broadcastMock).not.toHaveBeenCalled();
		} finally {
			watcher.close();
		}
	});

	it("detects atomic writes (write-to-temp then rename)", async () => {
		const broadcastMock = vi.fn().mockResolvedValue(undefined);
		const watcher = createWorkspaceStateWatcher({
			broadcastRuntimeWorkspaceStateUpdated: broadcastMock,
		});

		try {
			watcher.watch(workspaceId, workspacePath, tempDir);

			// Simulate atomic write like lockedFileSystem.writeJsonFileAtomic:
			// 1. Write to temp file  2. Rename to meta.json
			const tempFile = join(tempDir, `meta.json.tmp.${process.pid}.${Date.now()}.${randomUUID()}`);
			await writeFile(tempFile, createMetaJson(2));
			await rename(tempFile, metaPath);

			await delay(POLL_WAIT_MS);

			expect(broadcastMock).toHaveBeenCalledWith(workspaceId, workspacePath);
		} finally {
			watcher.close();
		}
	});

	it("close stops all watchers", async () => {
		const broadcastMock = vi.fn().mockResolvedValue(undefined);
		const watcher = createWorkspaceStateWatcher({
			broadcastRuntimeWorkspaceStateUpdated: broadcastMock,
		});

		watcher.watch(workspaceId, workspacePath, tempDir);
		watcher.close();

		await writeFile(metaPath, createMetaJson(2));
		await delay(POLL_WAIT_MS);

		expect(broadcastMock).not.toHaveBeenCalled();
	});
});
