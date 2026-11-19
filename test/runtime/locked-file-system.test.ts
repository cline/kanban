import { join } from "node:path";

import type { LockOptions } from "proper-lockfile";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempDir } from "../utilities/temp-dir";

const lockfileMocks = vi.hoisted(() => ({
	lock: vi.fn(),
	release: vi.fn(async () => {}),
}));

vi.mock("proper-lockfile", () => ({
	lock: lockfileMocks.lock,
}));

import { LockedFileSystem } from "../../src/fs/locked-file-system";

function readLockOptions(callIndex = 0): LockOptions {
	const options = lockfileMocks.lock.mock.calls[callIndex]?.[1] as LockOptions | undefined;
	if (!options) {
		throw new Error("Expected proper-lockfile.lock to have been called.");
	}
	return options;
}

function readCompromisedHandler(callIndex = 0): NonNullable<LockOptions["onCompromised"]> {
	const handler = readLockOptions(callIndex).onCompromised;
	if (!handler) {
		throw new Error("Expected an onCompromised handler to be installed.");
	}
	return handler;
}

describe("LockedFileSystem", () => {
	const emitWarning = vi.spyOn(process, "emitWarning");

	beforeEach(() => {
		emitWarning.mockReset();
		emitWarning.mockImplementation(() => {});
		lockfileMocks.release.mockReset();
		lockfileMocks.release.mockResolvedValue(undefined);
		lockfileMocks.lock.mockReset();
		lockfileMocks.lock.mockResolvedValue(lockfileMocks.release);
	});

	afterAll(() => {
		emitWarning.mockRestore();
	});

	it("installs an onCompromised handler even when the caller provides none", async () => {
		const tempDir = createTempDir("kanban-locked-fs-");
		try {
			const filePath = join(tempDir.path, "state.json");
			const lockedFileSystem = new LockedFileSystem();

			await lockedFileSystem.withLock({ path: filePath, type: "file" }, async () => {});

			expect(lockfileMocks.lock).toHaveBeenCalledTimes(1);
			expect(readLockOptions().onCompromised).toBeTypeOf("function");
			expect(lockfileMocks.release).toHaveBeenCalledTimes(1);
		} finally {
			tempDir.cleanup();
		}
	});

	it("reports a compromised lock instead of throwing out of the timer callback", async () => {
		const tempDir = createTempDir("kanban-locked-fs-");
		try {
			const filePath = join(tempDir.path, "state.json");
			const lockedFileSystem = new LockedFileSystem();

			await lockedFileSystem.withLock({ path: filePath, type: "file" }, async () => {});
			const compromised = Object.assign(new Error("ENOENT: no such file or directory, stat"), {
				code: "ECOMPROMISED",
			});

			expect(() => readCompromisedHandler()(compromised)).not.toThrow();
			expect(emitWarning).toHaveBeenCalledWith(
				expect.stringContaining("Lock compromised for"),
				expect.objectContaining({ code: "KANBAN_LOCK_COMPROMISED" }),
			);
		} finally {
			tempDir.cleanup();
		}
	});

	it("forwards a compromised lock to a caller-provided handler", async () => {
		const tempDir = createTempDir("kanban-locked-fs-");
		try {
			const filePath = join(tempDir.path, "state.json");
			const lockedFileSystem = new LockedFileSystem();
			const onCompromised = vi.fn();

			await lockedFileSystem.withLock({ path: filePath, type: "file", onCompromised }, async () => {});
			const compromised = new Error("lock lost");
			readCompromisedHandler()(compromised);

			expect(onCompromised).toHaveBeenCalledWith(compromised);
		} finally {
			tempDir.cleanup();
		}
	});

	it("does not rethrow when a caller-provided handler fails", async () => {
		const tempDir = createTempDir("kanban-locked-fs-");
		try {
			const filePath = join(tempDir.path, "state.json");
			const lockedFileSystem = new LockedFileSystem();
			const onCompromised = vi.fn(() => {
				throw new Error("handler exploded");
			});

			await lockedFileSystem.withLock({ path: filePath, type: "file", onCompromised }, async () => {});

			expect(() => readCompromisedHandler()(new Error("lock lost"))).not.toThrow();
			expect(emitWarning).toHaveBeenCalledWith(
				expect.stringContaining("onCompromised handler failed for"),
				expect.objectContaining({ code: "KANBAN_LOCK_HANDLER_FAILED" }),
			);
		} finally {
			tempDir.cleanup();
		}
	});

	it("keeps the operation result when releasing a compromised lock fails", async () => {
		const tempDir = createTempDir("kanban-locked-fs-");
		try {
			const filePath = join(tempDir.path, "state.json");
			const lockedFileSystem = new LockedFileSystem();
			lockfileMocks.release.mockRejectedValue(new Error("Lock is already released"));

			const result = await lockedFileSystem.withLock({ path: filePath, type: "file" }, async () => "written");

			expect(result).toBe("written");
			expect(emitWarning).toHaveBeenCalledWith(
				expect.stringContaining("Lock release failed"),
				expect.objectContaining({ code: "KANBAN_LOCK_RELEASE_FAILED" }),
			);
		} finally {
			tempDir.cleanup();
		}
	});
});
