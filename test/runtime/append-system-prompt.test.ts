import { describe, expect, it } from "vitest";

import {
	renderAppendSystemPrompt,
	resolveAppendSystemPromptCommandPrefix,
	resolveHomeAgentAppendSystemPrompt,
} from "../../src/prompts/append-system-prompt.js";

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
});

describe("resolveHomeAgentAppendSystemPrompt", () => {
	it("returns null for non-home task sessions", () => {
		expect(resolveHomeAgentAppendSystemPrompt("task-1")).toBeNull();
	});

	it("returns the appended prompt for home sidebar sessions", () => {
		const prompt = resolveHomeAgentAppendSystemPrompt("__home_agent__:workspace-1:codex:abc123", {
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
	});
});
