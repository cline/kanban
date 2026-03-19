import { describe, expect, it, vi } from "vitest";

import { mirrorIgnoredPath } from "../../src/workspace/task-worktree.js";

function createErrnoError(code: string): NodeJS.ErrnoException {
	const error = new Error(code) as NodeJS.ErrnoException;
	error.code = code;
	return error;
}

describe("mirrorIgnoredPath", () => {
	it("mirrors successfully when symlink succeeds", async () => {
		const createSymlink = vi.fn(async () => {});
		await expect(
			mirrorIgnoredPath({
				sourcePath: "/source",
				targetPath: "/target",
				isDirectory: true,
				createSymlink,
			}),
		).resolves.toBe("mirrored");
	});

	it("skips mirroring when symlink fails with EPERM", async () => {
		const createSymlink = vi.fn(async () => {
			throw createErrnoError("EPERM");
		});

		await expect(
			mirrorIgnoredPath({
				sourcePath: "/source",
				targetPath: "/target",
				isDirectory: true,
				createSymlink,
			}),
		).resolves.toBe("skipped");
	});

	it("skips mirroring when symlink fails with non-errno errors", async () => {
		const createSymlink = vi.fn(async () => {
			throw new Error("unexpected");
		});

		await expect(
			mirrorIgnoredPath({
				sourcePath: "/source",
				targetPath: "/target",
				isDirectory: true,
				createSymlink,
			}),
		).resolves.toBe("skipped");
	});

	it("skips mirroring when symlink fails with EIO", async () => {
		const createSymlink = vi.fn(async () => {
			throw createErrnoError("EIO");
		});

		await expect(
			mirrorIgnoredPath({
				sourcePath: "/source",
				targetPath: "/target",
				isDirectory: true,
				createSymlink,
			}),
		).resolves.toBe("skipped");
	});
});
