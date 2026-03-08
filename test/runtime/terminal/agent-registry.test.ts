import { describe, expect, it } from "vitest";

import type { RuntimeConfigState } from "../../../src/runtime/config/runtime-config.js";
import { buildRuntimeConfigResponse } from "../../../src/runtime/terminal/agent-registry.js";

function createRuntimeConfigState(overrides: Partial<RuntimeConfigState> = {}): RuntimeConfigState {
	return {
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project-config.json",
		selectedAgentId: "claude",
		selectedShortcutId: null,
		agentAutonomousModeEnabled: true,
		readyForReviewNotificationsEnabled: true,
		shortcuts: [],
		commitPromptTemplate: "commit",
		openPrPromptTemplate: "pr",
		commitPromptTemplateDefault: "commit",
		openPrPromptTemplateDefault: "pr",
		...overrides,
	};
}

describe("buildRuntimeConfigResponse", () => {
	it("includes autonomous flags in curated agent commands when enabled", () => {
		const config = createRuntimeConfigState({
			agentAutonomousModeEnabled: true,
		});

		const response = buildRuntimeConfigResponse(config);

		expect(response.agentAutonomousModeEnabled).toBe(true);
		expect(response.agents.find((agent) => agent.id === "claude")?.defaultArgs).toEqual([
			"--dangerously-skip-permissions",
		]);
		expect(response.agents.find((agent) => agent.id === "codex")?.defaultArgs).toEqual([
			"--dangerously-bypass-approvals-and-sandbox",
		]);
		expect(response.agents.find((agent) => agent.id === "gemini")?.defaultArgs).toEqual(["--yolo"]);
		expect(response.agents.find((agent) => agent.id === "cline")?.defaultArgs).toEqual(["--auto-approve-all"]);
	});

	it("omits autonomous flags from curated agent commands when disabled", () => {
		const config = createRuntimeConfigState({
			agentAutonomousModeEnabled: false,
		});

		const response = buildRuntimeConfigResponse(config);

		expect(response.agentAutonomousModeEnabled).toBe(false);
		expect(response.agents.find((agent) => agent.id === "claude")?.defaultArgs).toEqual([]);
		expect(response.agents.find((agent) => agent.id === "codex")?.defaultArgs).toEqual([]);
		expect(response.agents.find((agent) => agent.id === "gemini")?.defaultArgs).toEqual([]);
		expect(response.agents.find((agent) => agent.id === "opencode")?.defaultArgs).toEqual([]);
		expect(response.agents.find((agent) => agent.id === "cline")?.defaultArgs).toEqual([]);
		expect(response.agents.find((agent) => agent.id === "claude")?.command).toBe("claude");
		expect(response.agents.find((agent) => agent.id === "codex")?.command).toBe("codex");
	});
});
