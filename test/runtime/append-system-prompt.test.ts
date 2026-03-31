import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	renderAppendSystemPrompt,
	resolveAppendSystemPromptCommandPrefix,
	resolveHomeAgentAppendSystemPrompt,
} from "../../src/prompts/append-system-prompt";

describe("resolveAppendSystemPromptCommandPrefix", () => {
	it("returns npx prefix for npx transient installs", () => {
		const prefix = resolveAppendSystemPromptCommandPrefix({
			currentVersion: "0.1.10",
			cwd: "/Users/example/repo",
			argv: ["node", "/Users/example/.npm/_npx/593b71878a7c70f2/node_modules/kanban/dist/cli.js"],
			resolveRealPath: (path) => path,
		});
		expect(prefix).toBe("npx -y kanban");
	});

	it("returns bun x prefix for bun x transient installs", () => {
		const prefix = resolveAppendSystemPromptCommandPrefix({
			currentVersion: "0.1.10",
			cwd: "/Users/example/repo",
			argv: ["node", "/private/tmp/bunx-501-kanban@1.0.0/node_modules/kanban/dist/cli.js"],
			resolveRealPath: (path) => path,
		});
		expect(prefix).toBe("bun x kanban");
	});

	it("falls back to the current runnable invocation for local entrypoints", () => {
		const prefix = resolveAppendSystemPromptCommandPrefix({
			currentVersion: "0.1.10",
			cwd: "/Users/example/repo",
			execPath: "/usr/local/bin/node",
			execArgv: [],
			argv: ["node", "/Users/example/repo/dist/cli.js"],
			resolveRealPath: (path) => path,
		});
		expect(prefix).toBe("'/usr/local/bin/node' '/Users/example/repo/dist/cli.js'");
	});

	it("falls back to the current runnable invocation when realpath resolution fails", () => {
		const prefix = resolveAppendSystemPromptCommandPrefix({
			currentVersion: "0.1.10",
			cwd: "/Users/example/repo",
			execPath: "/usr/local/bin/node",
			execArgv: [],
			argv: ["node", "/tmp/missing-kanban-cli.js"],
			resolveRealPath: () => {
				throw new Error("missing");
			},
		});
		expect(prefix).toBe("'/usr/local/bin/node' '/tmp/missing-kanban-cli.js'");
	});
});

describe("renderAppendSystemPrompt", () => {
	it("renders Kanban sidebar guidance and command reference", () => {
		const rendered = renderAppendSystemPrompt("kanban");
		expect(rendered).toContain("Kanban sidebar agent");
		expect(rendered).toContain("kanban task create");
		expect(rendered).toContain("kanban task trash");
		expect(rendered).toContain("kanban task delete");
		expect(rendered).toContain("--column backlog|in_progress|review|trash");
		expect(rendered).toContain("Provide exactly one of");
		expect(rendered).toContain("task delete --column trash");
		expect(rendered).toContain("kanban task link");
		expect(rendered).toContain("If a task command fails because the runtime is unavailable");
		expect(rendered).toContain("If the user asks for GitHub work");
		expect(rendered).toContain("gh issue view");
		expect(rendered).toContain("If the user references Linear");
		expect(rendered).toContain("Current home agent: `unknown`");
		expect(rendered).not.toContain("claude mcp add --transport http --scope user linear https://mcp.linear.app/mcp");
		expect(rendered).not.toContain("codex mcp add linear --url https://mcp.linear.app/mcp");
	});

	it("renders only the active-agent Linear MCP guidance when an agent is provided", () => {
		const rendered = renderAppendSystemPrompt("kanban", {
			agentId: "codex",
		});

		expect(rendered).toContain("Current home agent: `codex`");
		expect(rendered).toContain("codex mcp add linear --url https://mcp.linear.app/mcp");
		expect(rendered).not.toContain("claude mcp add --transport http --scope user linear https://mcp.linear.app/mcp");
		expect(rendered).not.toContain("droid mcp add linear https://mcp.linear.app/mcp --type http");
	});

	it("renders the Agent Teams section with agent registry", () => {
		const rendered = renderAppendSystemPrompt("kanban");
		expect(rendered).toContain("# Agent Teams");
		expect(rendered).toContain("team_spawn_teammate");
		expect(rendered).toContain("team_run_task");
		expect(rendered).toContain("team_task");
		expect(rendered).toContain("team_send_message");
		expect(rendered).toContain("team_log_update");
		expect(rendered).toContain("team_await_run");
		expect(rendered).toContain("only Cline tasks support teams");
		expect(rendered).toContain("teammate-*");
		// Agent registry: built-in agents with capabilities are listed for team leader selection
		expect(rendered).toContain("Agent registry");
		expect(rendered).toContain("`cline`");
		expect(rendered).toContain("`claude`");
		expect(rendered).toContain("`codex`");
		expect(rendered).toContain("coding, review");
		expect(rendered).toContain("Choose agentId from the registry");
	});

	it("renders custom specialists when provided via .cline/agents/ markdown files", () => {
		// Write temporary .md specialist files and temporarily chdir so loadAgentSpecialists picks them up.
		const tmpDir = mkdtempSync(join(tmpdir(), "kb-test-"));
		mkdirSync(join(tmpDir, ".cline", "agents"), { recursive: true });
		writeFileSync(
			join(tmpDir, ".cline", "agents", "planner.md"),
			"---\nname: planner\nbaseAgentId: claude\ndescription: Plans and breaks down tasks\n---\n",
		);
		writeFileSync(
			join(tmpDir, ".cline", "agents", "poet.md"),
			"---\nname: poet\nbaseAgentId: cline\ndescription: Writes creative copy\nmodelId: claude-opus-4-5\n---\n",
		);
		const origCwd = process.cwd();
		process.chdir(tmpDir);
		try {
			const rendered = renderAppendSystemPrompt("kanban");
			expect(rendered).toContain("Custom specialists");
			expect(rendered).toContain("`planner`");
			expect(rendered).toContain("`poet`");
			expect(rendered).toContain("Plans and breaks down tasks");
			expect(rendered).toContain("Writes creative copy");
			// poet has a modelId — it should appear in the rendered line
			expect(rendered).toContain("model: claude-opus-4-5");
			// planner has no modelId — no model suffix
			expect(rendered).not.toContain("`planner` → claude — Plans and breaks down tasks · model:");
			// Selection guidance is present
			expect(rendered).toContain("prefer it over a generic built-in");
			expect(rendered).toContain("pass it as the modelId option to team_spawn_teammate");
		} finally {
			process.chdir(origCwd);
		}
	});

	it("renders the Available Agents section with all catalog entries", () => {
		const rendered = renderAppendSystemPrompt("kanban");
		expect(rendered).toContain("# Available Agents");
		// Cline is always shown as installed and teams-supporting
		expect(rendered).toContain("**Cline**");
		expect(rendered).toContain("teams: yes");
		// Other catalog entries are present
		expect(rendered).toContain("Claude Code");
		expect(rendered).toContain("OpenAI Codex");
		expect(rendered).toContain("teams: no");
		// Recommendation note
		expect(rendered).toContain("Cline is the only supported choice");
	});

	it("renders a numbered model list for specialist agent creation and requires selection", () => {
		const rendered = renderAppendSystemPrompt("kanban");
		// The Creating Specialist Agents section must be present
		expect(rendered).toContain("# Creating Specialist Agents");
		// Model selection step must require a pick, not allow skipping
		expect(rendered).toContain("do NOT proceed to step 2 until the user has chosen a model");
		// Numbered list of sidebar UI models
		expect(rendered).toContain("1. `anthropic/claude-opus-4.6`");
		expect(rendered).toContain("2. `anthropic/claude-sonnet-4.6`");
		expect(rendered).toContain("3. `openai/gpt-5.3-codex`");
		expect(rendered).toContain("4. `openai/gpt-5.4`");
		expect(rendered).toContain("5. `google/gemini-3.1-pro-preview`");
		expect(rendered).toContain("6. `google/gemini-3.1-flash-lite-preview`");
		expect(rendered).toContain("7. `xiaomi/mimo-v2-pro`");
		// Resolution rules are present
		expect(rendered).toContain("If the user types a number 1\u20137, resolve it to the corresponding model ID");
		expect(rendered).toContain("If the user types a non-numeric string, use it as the model ID exactly as typed");
		// Mandatory — no default fallback
		expect(rendered).toContain("do NOT proceed or assume a default if the user has not yet replied");
		// Old placeholder text must be gone
		expect(rendered).not.toContain("Current provider: `{providerId}`");
		expect(rendered).not.toContain("press Enter to use the current default");
	});
});

describe("resolveHomeAgentAppendSystemPrompt", () => {
	it("returns null for non-home task sessions", () => {
		expect(resolveHomeAgentAppendSystemPrompt("task-1")).toBeNull();
	});

	it("returns the appended prompt for current home sidebar sessions", () => {
		const prompt = resolveHomeAgentAppendSystemPrompt("__home_agent__:workspace-1:codex", {
			currentVersion: "0.1.10",
			cwd: "/Users/example/repo",
			execPath: "/usr/local/bin/node",
			execArgv: [],
			argv: ["node", "/Users/example/repo/dist/cli.js"],
			resolveRealPath: (path) => path,
		});
		expect(prompt).toContain("Kanban sidebar agent");
		expect(prompt).toContain("'/usr/local/bin/node' '/Users/example/repo/dist/cli.js' task list");
		expect(prompt).toContain("Current home agent: `codex`");
		expect(prompt).toContain("codex mcp add linear --url https://mcp.linear.app/mcp");
		expect(prompt).not.toContain("claude mcp add --transport http --scope user linear https://mcp.linear.app/mcp");
		// Agent Teams and Available Agents sections are present in all home agent prompts
		expect(prompt).toContain("# Agent Teams");
		expect(prompt).toContain("# Available Agents");
	});

	it("returns active-agent guidance for droid home sidebar sessions", () => {
		const prompt = resolveHomeAgentAppendSystemPrompt("__home_agent__:workspace-1:droid", {
			currentVersion: "0.1.10",
			cwd: "/Users/example/repo",
			execPath: "/usr/local/bin/node",
			execArgv: [],
			argv: ["node", "/Users/example/repo/dist/cli.js"],
			resolveRealPath: (path) => path,
		});
		expect(prompt).toContain("Current home agent: `droid`");
		expect(prompt).toContain("droid mcp add linear https://mcp.linear.app/mcp --type http");
	});
});
