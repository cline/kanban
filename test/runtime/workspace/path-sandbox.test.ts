import path from "node:path";
import { describe, expect, it } from "vitest";

import { isPathWithinRoot } from "../../../src/workspace/path-sandbox";

describe("isPathWithinRoot", () => {
	// ── POSIX paths ─────────────────────────────────────────

	it("returns true when candidate is the root itself", () => {
		expect(isPathWithinRoot("/home/user/workspace", "/home/user/workspace")).toBe(true);
	});

	it("returns true when candidate is a child of the root", () => {
		expect(isPathWithinRoot("/home/user/workspace", "/home/user/workspace/repo")).toBe(true);
	});

	it("returns true for a deeply nested child path", () => {
		expect(isPathWithinRoot("/home/user/workspace", "/home/user/workspace/a/b/c")).toBe(true);
	});

	it("returns false when candidate is the parent of the root", () => {
		expect(isPathWithinRoot("/home/user/workspace", "/home/user")).toBe(false);
	});

	it("returns false when candidate is outside the root", () => {
		expect(isPathWithinRoot("/home/user/workspace", "/tmp/other")).toBe(false);
	});

	it("returns false for sibling directory with similar prefix", () => {
		expect(isPathWithinRoot("/home/user/workspace", "/home/user/workspace-other/repo")).toBe(false);
	});

	it("returns false for parent traversal that escapes root", () => {
		expect(isPathWithinRoot("/home/user/workspace", "/home/user/workspace/../other")).toBe(false);
	});

	it("returns true when root has trailing separator", () => {
		expect(isPathWithinRoot("/home/user/workspace/", "/home/user/workspace/repo")).toBe(true);
	});

	it("returns true when root has trailing separator and candidate equals root", () => {
		expect(isPathWithinRoot("/home/user/workspace/", "/home/user/workspace")).toBe(true);
	});

	// ── Windows paths (using path.win32) ────────────────────

	describe("Windows paths (path.win32)", () => {
		/**
		 * Build a Windows-compatible isPathWithinRoot using path.win32 so we
		 * can exercise backslash + drive-letter semantics on any OS.
		 */
		function isPathWithinRootWin32(rootPath: string, candidatePath: string): boolean {
			const resolvedRoot = path.win32.resolve(rootPath);
			const resolvedCandidate = path.win32.resolve(candidatePath);
			if (resolvedCandidate === resolvedRoot) {
				return true;
			}
			const rel = path.win32.relative(resolvedRoot, resolvedCandidate);
			return rel !== ".." && !rel.startsWith(`..${path.win32.sep}`) && !path.win32.isAbsolute(rel);
		}

		it("accepts a child path on the same drive", () => {
			expect(isPathWithinRootWin32("C:\\workspace", "C:\\workspace\\repo")).toBe(true);
		});

		it("rejects a path on a different root prefix", () => {
			expect(isPathWithinRootWin32("C:\\workspace", "C:\\workspace-other\\repo")).toBe(false);
		});

		it("handles trailing backslash on root", () => {
			expect(isPathWithinRootWin32("C:\\workspace\\", "C:\\workspace\\repo")).toBe(true);
		});

		it("returns true when root equals candidate", () => {
			expect(isPathWithinRootWin32("C:\\workspace", "C:\\workspace")).toBe(true);
		});

		it("rejects candidate that escapes via ..", () => {
			expect(isPathWithinRootWin32("C:\\workspace", "C:\\workspace\\..\\other")).toBe(false);
		});

		it("rejects different drive letter", () => {
			expect(isPathWithinRootWin32("C:\\workspace", "D:\\workspace\\repo")).toBe(false);
		});

		it("accepts deeply nested child path", () => {
			expect(isPathWithinRootWin32("C:\\workspace", "C:\\workspace\\a\\b\\c")).toBe(true);
		});
	});
});
