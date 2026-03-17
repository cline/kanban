import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	MAX_WORKSPACE_MARKDOWN_FILE_BYTES,
	readWorkspaceMarkdownFile,
} from "../../../src/workspace/read-workspace-file.js";
import { createTempDir } from "../../utilities/temp-dir.js";

describe("readWorkspaceMarkdownFile", () => {
	it("reads an importable markdown file within the workspace", async () => {
		const { path, cleanup } = createTempDir("kanban-read-workspace-file-");
		try {
			mkdirSync(join(path, "docs"), { recursive: true });
			writeFileSync(join(path, "docs", "plan.md"), "# Plan\n\n- [ ] Ship feature\n", "utf8");

			await expect(readWorkspaceMarkdownFile(path, "docs/plan.md")).resolves.toEqual({
				path: "docs/plan.md",
				content: "# Plan\n\n- [ ] Ship feature\n",
			});
		} finally {
			cleanup();
		}
	});

	it("rejects traversal outside the workspace", async () => {
		const { path, cleanup } = createTempDir("kanban-read-workspace-file-");
		try {
			await expect(readWorkspaceMarkdownFile(path, "../outside.md")).rejects.toMatchObject({
				code: "BAD_REQUEST",
				message: "File path must stay within the workspace.",
			});
		} finally {
			cleanup();
		}
	});

	it("rejects unsupported file extensions", async () => {
		const { path, cleanup } = createTempDir("kanban-read-workspace-file-");
		try {
			writeFileSync(join(path, "notes.txt"), "not markdown", "utf8");

			await expect(readWorkspaceMarkdownFile(path, "notes.txt")).rejects.toMatchObject({
				code: "BAD_REQUEST",
				message: "Only .md, .markdown, and .mdx files can be imported.",
			});
		} finally {
			cleanup();
		}
	});

	it("rejects files larger than the import size cap", async () => {
		const { path, cleanup } = createTempDir("kanban-read-workspace-file-");
		try {
			writeFileSync(join(path, "large.md"), "a".repeat(MAX_WORKSPACE_MARKDOWN_FILE_BYTES + 1), "utf8");

			await expect(readWorkspaceMarkdownFile(path, "large.md")).rejects.toMatchObject({
				code: "BAD_REQUEST",
				message: "Markdown file is too large to import.",
			});
		} finally {
			cleanup();
		}
	});
});
