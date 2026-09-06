import { describe, expect, it } from "vitest";

import {
	getAgentCapabilities,
	isChatPanelAgent,
	isClineSdkBackend,
	PTY_TUI_CAPABILITIES,
	RUNTIME_AGENT_CATALOG,
} from "../../../src/core/agent-catalog";

describe("agent catalog capabilities", () => {
	it("gives TUI CLIs a long-lived PTY terminal surface", () => {
		for (const id of ["claude", "codex", "droid", "kiro", "gemini", "opencode"] as const) {
			expect(getAgentCapabilities(id)).toEqual(PTY_TUI_CAPABILITIES);
			expect(isChatPanelAgent(id)).toBe(false);
			expect(isClineSdkBackend(id)).toBe(false);
		}
	});

	it("routes Cline through the in-process SDK chat panel", () => {
		expect(getAgentCapabilities("cline")).toMatchObject({
			uiSurface: "chat",
			backend: "cline-sdk",
			slashSource: "cline-sdk",
			followUp: "sdk-send",
			showModelPicker: true,
		});
		expect(isChatPanelAgent("cline")).toBe(true);
		expect(isClineSdkBackend("cline")).toBe(true);
	});

	it("routes AG2 as a one-shot PTY chat agent without Cline hydrate", () => {
		expect(getAgentCapabilities("ag2")).toMatchObject({
			uiSurface: "chat",
			backend: "pty",
			sessionKind: "oneshot",
			autoRestart: false,
			preserveChatAcrossRestarts: true,
			slashSource: "project-skills",
			followUp: "restart-pty-with-context",
			showModelPicker: false,
			rejectFollowUpWhileRunning: true,
		});
		expect(isChatPanelAgent("ag2")).toBe(true);
		expect(isClineSdkBackend("ag2")).toBe(false);
	});

	it("requires every catalog row to declare capabilities", () => {
		for (const entry of RUNTIME_AGENT_CATALOG) {
			expect(entry.capabilities).toEqual(getAgentCapabilities(entry.id));
		}
	});
});
