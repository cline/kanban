import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDirectoryBrowseApi } from "../../../src/trpc/directory-browse-api";

function createTempRoot(): string {
	const root = join(homedir(), `.kanban-test-list-directories-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	mkdirSync(root, { recursive: true });
	return root;
}

describe("createDirectoryBrowseApi listDirectories", () => {
	let tempRoot: string;

	beforeEach(() => {
		tempRoot = createTempRoot();
	});

	afterEach(() => {
		rmSync(tempRoot, { recursive: true, force: true });
	});

	it("returns directories in the requested path", async () => {
		mkdirSync(join(tempRoot, "alpha"));
		mkdirSync(join(tempRoot, "beta"));
		mkdirSync(join(tempRoot, "gamma"));

		const api = createDirectoryBrowseApi({ directoryBrowseRoot: tempRoot });
		const result = await api.listDirectories({ path: tempRoot });

		expect(result.directories).toEqual([
			{ name: "alpha", path: join(tempRoot, "alpha") },
			{ name: "beta", path: join(tempRoot, "beta") },
			{ name: "gamma", path: join(tempRoot, "gamma") },
		]);
	});

	it("returns directories sorted alphabetically", async () => {
		mkdirSync(join(tempRoot, "zulu"));
		mkdirSync(join(tempRoot, "alpha"));
		mkdirSync(join(tempRoot, "mike"));

		const api = createDirectoryBrowseApi({ directoryBrowseRoot: tempRoot });
		const result = await api.listDirectories({ path: tempRoot });

		const names = result.directories.map((d) => d.name);
		expect(names).toEqual(["alpha", "mike", "zulu"]);
	});

	it("filters out files, returning only directories", async () => {
		mkdirSync(join(tempRoot, "dir-a"));
		writeFileSync(join(tempRoot, "file-a.txt"), "content");
		mkdirSync(join(tempRoot, "dir-b"));
		writeFileSync(join(tempRoot, "file-b.txt"), "content");

		const api = createDirectoryBrowseApi({ directoryBrowseRoot: tempRoot });
		const result = await api.listDirectories({ path: tempRoot });

		expect(result.directories).toEqual([
			{ name: "dir-a", path: join(tempRoot, "dir-a") },
			{ name: "dir-b", path: join(tempRoot, "dir-b") },
		]);
	});

	it("returns empty directories array for empty directory", async () => {
		const emptyDir = join(tempRoot, "empty");
		mkdirSync(emptyDir);

		const api = createDirectoryBrowseApi({ directoryBrowseRoot: tempRoot });
		const result = await api.listDirectories({ path: emptyDir });

		expect(result.directories).toEqual([]);
	});

	it("lists subdirectories when navigating deeper", async () => {
		const parent = join(tempRoot, "parent");
		mkdirSync(parent);
		mkdirSync(join(parent, "child-a"));
		mkdirSync(join(parent, "child-b"));

		const api = createDirectoryBrowseApi({ directoryBrowseRoot: tempRoot });
		const result = await api.listDirectories({ path: parent });

		expect(result.directories).toEqual([
			{ name: "child-a", path: join(parent, "child-a") },
			{ name: "child-b", path: join(parent, "child-b") },
		]);
	});

	it("rejects paths outside the browse root with FORBIDDEN", async () => {
		const api = createDirectoryBrowseApi({ directoryBrowseRoot: tempRoot });

		await expect(api.listDirectories({ path: "/etc" })).rejects.toThrow(TRPCError);
		await expect(api.listDirectories({ path: "/etc" })).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});

	it("rejects path traversal attempts with FORBIDDEN", async () => {
		mkdirSync(join(tempRoot, "legit"));

		const api = createDirectoryBrowseApi({ directoryBrowseRoot: tempRoot });
		const traversalPath = join(tempRoot, "legit", "..", "..", "etc");

		await expect(api.listDirectories({ path: traversalPath })).rejects.toThrow(TRPCError);
		await expect(api.listDirectories({ path: traversalPath })).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});

	it("rejects traversal via encoded path that resolves outside root", async () => {
		const api = createDirectoryBrowseApi({ directoryBrowseRoot: tempRoot });
		const traversalPath = `${tempRoot}/../../etc`;

		await expect(api.listDirectories({ path: traversalPath })).rejects.toThrow(TRPCError);
		await expect(api.listDirectories({ path: traversalPath })).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});

	it("allows the browse root path itself", async () => {
		mkdirSync(join(tempRoot, "sub"));

		const api = createDirectoryBrowseApi({ directoryBrowseRoot: tempRoot });
		const result = await api.listDirectories({ path: tempRoot });

		expect(result.directories).toEqual([{ name: "sub", path: join(tempRoot, "sub") }]);
	});

	it("throws NOT_FOUND for non-existent paths within the browse root", async () => {
		const api = createDirectoryBrowseApi({ directoryBrowseRoot: tempRoot });
		const nonExistent = join(tempRoot, "does-not-exist");

		await expect(api.listDirectories({ path: nonExistent })).rejects.toThrow(TRPCError);
		await expect(api.listDirectories({ path: nonExistent })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("throws BAD_REQUEST when path points to a file instead of a directory", async () => {
		const filePath = join(tempRoot, "a-file.txt");
		writeFileSync(filePath, "content");

		const api = createDirectoryBrowseApi({ directoryBrowseRoot: tempRoot });

		await expect(api.listDirectories({ path: filePath })).rejects.toThrow(TRPCError);
		await expect(api.listDirectories({ path: filePath })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});

	it("defaults the browse root to os.homedir() when not configured", async () => {
		const api = createDirectoryBrowseApi({});
		const result = await api.listDirectories({ path: homedir() });

		expect(Array.isArray(result.directories)).toBe(true);
		for (const entry of result.directories) {
			expect(typeof entry.name).toBe("string");
			expect(typeof entry.path).toBe("string");
			expect(entry.path).toBe(join(homedir(), entry.name));
		}
	});

	it("defaults to os.homedir() and rejects paths outside it", async () => {
		const api = createDirectoryBrowseApi({});

		const outsidePath = resolve("/tmp") === resolve(homedir()) ? "/var" : "/tmp";
		const homeResolved = resolve(homedir());
		const outsideResolved = resolve(outsidePath);

		if (!outsideResolved.startsWith(homeResolved + sep) && outsideResolved !== homeResolved) {
			await expect(api.listDirectories({ path: outsidePath })).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
		}
	});

	it("skips entries that cannot be stat'd (e.g., broken symlinks)", async () => {
		const { symlinkSync } = await import("node:fs");

		mkdirSync(join(tempRoot, "valid-dir"));
		symlinkSync(join(tempRoot, "nonexistent-target"), join(tempRoot, "broken-link"));

		const api = createDirectoryBrowseApi({ directoryBrowseRoot: tempRoot });
		const result = await api.listDirectories({ path: tempRoot });

		expect(result.directories).toEqual([{ name: "valid-dir", path: join(tempRoot, "valid-dir") }]);
	});

	it("includes each directory entry with both name and absolute path", async () => {
		mkdirSync(join(tempRoot, "my-folder"));

		const api = createDirectoryBrowseApi({ directoryBrowseRoot: tempRoot });
		const result = await api.listDirectories({ path: tempRoot });

		expect(result.directories).toHaveLength(1);
		expect(result.directories[0]).toEqual({
			name: "my-folder",
			path: join(tempRoot, "my-folder"),
		});
	});

	it("uses a configurable directoryBrowseRoot to restrict listing", async () => {
		const innerRoot = join(tempRoot, "inner");
		mkdirSync(innerRoot);
		mkdirSync(join(innerRoot, "allowed"));
		mkdirSync(join(tempRoot, "outside"));

		const api = createDirectoryBrowseApi({ directoryBrowseRoot: innerRoot });

		const result = await api.listDirectories({ path: innerRoot });
		expect(result.directories).toEqual([{ name: "allowed", path: join(innerRoot, "allowed") }]);

		await expect(api.listDirectories({ path: tempRoot })).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});
});
