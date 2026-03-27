import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeTrpcWorkspaceScope } from "../../src/trpc/app-router.js";
import { createPromptsApi } from "../../src/trpc/prompts-api.js";

// Mock the catalog fetch to avoid network calls
vi.mock("../../src/services/prompts-service.js", () => ({
	fetchPromptsCatalog: vi.fn().mockResolvedValue({
		items: [
			{
				promptId: "test-rule",
				githubUrl: "https://github.com/cline/prompts/blob/main/.clinerules/test-rule.md",
				name: "Test Rule",
				author: "testauthor",
				description: "A test rule",
				category: "General",
				tags: [],
				type: "rule",
				content: "# Test Rule\nContent here.",
				version: "1.0.0",
				globs: [],
				createdAt: "2025-01-01T00:00:00Z",
				updatedAt: "2025-01-01T00:00:00Z",
			},
		],
		lastUpdated: new Date().toISOString(),
	}),
}));

describe("prompts-api", () => {
	let workspacePath: string;
	let scope: RuntimeTrpcWorkspaceScope;
	let api: ReturnType<typeof createPromptsApi>;

	beforeEach(async () => {
		workspacePath = join(tmpdir(), `kanban-prompts-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
		await mkdir(workspacePath, { recursive: true });
		scope = { workspaceId: "test-workspace", workspacePath };
		api = createPromptsApi();
	});

	afterEach(async () => {
		await rm(workspacePath, { recursive: true, force: true });
	});

	it("fetchCatalog returns the mocked catalog", async () => {
		const catalog = await api.fetchCatalog();
		expect(catalog.items).toHaveLength(1);
		expect(catalog.items[0]!.promptId).toBe("test-rule");
	});

	it("applyPrompt writes a file to .clinerules/ for rules", async () => {
		const result = await api.applyPrompt(scope, {
			promptId: "test-rule",
			type: "rule",
			content: "# My Rule\nDo things.",
			name: "Test Rule",
		});

		expect(result.ok).toBe(true);

		const filePath = join(workspacePath, ".clinerules", "test-rule.md");
		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("# My Rule\nDo things.");
	});

	it("applyPrompt writes a file to workflows/ for workflows", async () => {
		const result = await api.applyPrompt(scope, {
			promptId: "test-workflow",
			type: "workflow",
			content: "# My Workflow\nSteps here.",
			name: "Test Workflow",
		});

		expect(result.ok).toBe(true);

		const filePath = join(workspacePath, "workflows", "test-workflow.md");
		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("# My Workflow\nSteps here.");
	});

	it("removePrompt deletes the file", async () => {
		// First apply
		await api.applyPrompt(scope, {
			promptId: "test-rule",
			type: "rule",
			content: "# Content",
			name: "Test Rule",
		});

		// Then remove
		const result = await api.removePrompt(scope, {
			promptId: "test-rule",
			type: "rule",
			name: "Test Rule",
		});

		expect(result.ok).toBe(true);

		// Verify file is gone
		const entries = await readdir(join(workspacePath, ".clinerules")).catch(() => []);
		expect(entries).not.toContain("test-rule.md");
	});

	it("removePrompt returns ok for non-existent file", async () => {
		const result = await api.removePrompt(scope, {
			promptId: "nonexistent",
			type: "rule",
			name: "Nonexistent",
		});

		expect(result.ok).toBe(true);
	});

	it("getAppliedPrompts scans .clinerules/ and workflows/", async () => {
		// Write some files
		await mkdir(join(workspacePath, ".clinerules"), { recursive: true });
		await mkdir(join(workspacePath, "workflows"), { recursive: true });
		await writeFile(join(workspacePath, ".clinerules", "rule-a.md"), "content");
		await writeFile(join(workspacePath, ".clinerules", "rule-b.md"), "content");
		await writeFile(join(workspacePath, "workflows", "wf-1.md"), "content");

		const result = await api.getAppliedPrompts(scope);

		expect(result.appliedPromptIds).toContain("rule:rule-a");
		expect(result.appliedPromptIds).toContain("rule:rule-b");
		expect(result.appliedPromptIds).toContain("workflow:wf-1");
		expect(result.appliedPromptIds).toHaveLength(3);
	});

	it("getAppliedPrompts returns empty for missing directories", async () => {
		const result = await api.getAppliedPrompts(scope);
		expect(result.appliedPromptIds).toHaveLength(0);
	});
});
