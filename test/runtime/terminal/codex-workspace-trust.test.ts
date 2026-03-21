import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	hasCodexWorkspaceTrustPrompt,
	shouldAutoConfirmCodexWorkspaceTrust,
} from "../../../src/terminal/codex-workspace-trust.js";

const originalHome = process.env.HOME;
let tempHome: string | null = null;

function setupTempHome(): string {
	tempHome = mkdtempSync(join(tmpdir(), "kanban-codex-workspace-trust-"));
	process.env.HOME = tempHome;
	return tempHome;
}

afterEach(() => {
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}
	if (tempHome) {
		rmSync(tempHome, { recursive: true, force: true });
		tempHome = null;
	}
});

describe("codex workspace trust helpers", () => {
	it("detects Codex trust prompt", () => {
		const codexPrompt = `
You are in /Users/saoud/.cline/kanban/worktrees/6df3a/mcp-swift-sdk

Do you trust the contents of this directory? Working with untrusted
contents comes with higher risk of prompt injection.

› 1. Yes, continue
  2. No, quit

Press enter to continue`;
		expect(hasCodexWorkspaceTrustPrompt(codexPrompt)).toBe(true);
	});

	it("detects Codex trust prompt with ANSI formatting", () => {
		const ansiPrompt =
			"Do you trust the \u001b[31mcontents\u001b[0m of this directory? Working with untrusted contents comes with higher risk of prompt injection.";
		expect(hasCodexWorkspaceTrustPrompt(ansiPrompt)).toBe(true);
	});

	it("auto-confirms all codex sessions", () => {
		const home = setupTempHome();
		const taskWorktreePath = join(home, ".cline", "kanban", "worktrees", "task-123", "context");
		const externalPath = join(home, "projects", "repo");

		expect(shouldAutoConfirmCodexWorkspaceTrust("codex", taskWorktreePath)).toBe(true);
		expect(shouldAutoConfirmCodexWorkspaceTrust("codex", externalPath)).toBe(true);
		expect(shouldAutoConfirmCodexWorkspaceTrust("claude", taskWorktreePath)).toBe(false);
	});
});
