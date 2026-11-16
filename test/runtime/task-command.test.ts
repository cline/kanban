import { afterEach, describe, expect, it, vi } from "vitest";

import {
	buildTaskAgentSettingsForCreate,
	buildTaskAgentSettingsForUpdate,
	formatTaskAgentSettings,
	resolveSettingsFlag,
	shouldWarnOnExplicitAgentId,
	warnOnAgentSettingsMechanismGaps,
} from "../../src/commands/task";
import type { RuntimeTaskAgentSettings } from "../../src/core/api-contract";

describe("buildTaskAgentSettingsForCreate", () => {
	it("returns undefined when no settings fields are provided", () => {
		expect(buildTaskAgentSettingsForCreate({})).toBeUndefined();
	});

	it("stores opaque values verbatim without validation", () => {
		expect(
			buildTaskAgentSettingsForCreate({
				providerId: "moonshot",
				modelId: "kimi-k2-0905-preview",
				reasoningEffort: "ultracode",
			}),
		).toEqual({
			providerId: "moonshot",
			modelId: "kimi-k2-0905-preview",
			reasoningEffort: "ultracode",
		});
	});

	it("treats inherit (null) reasoning effort as no explicit override", () => {
		expect(buildTaskAgentSettingsForCreate({ reasoningEffort: null })).toBeUndefined();
	});

	it("treats default reasoning effort as an empty override marker", () => {
		expect(buildTaskAgentSettingsForCreate({ reasoningEffort: "default" })).toEqual({});
	});

	it("treats blank provider/model values as unset", () => {
		expect(buildTaskAgentSettingsForCreate({ providerId: "  ", modelId: "" })).toBeUndefined();
	});
});

describe("buildTaskAgentSettingsForUpdate", () => {
	const CURRENT: RuntimeTaskAgentSettings = {
		providerId: "anthropic",
		modelId: "claude-sonnet-4-20250514",
		reasoningEffort: "high",
	};

	it("returns undefined when no settings fields are provided", () => {
		expect(buildTaskAgentSettingsForUpdate(CURRENT, {})).toBeUndefined();
	});

	it("merges new values over current settings", () => {
		expect(
			buildTaskAgentSettingsForUpdate(CURRENT, {
				modelId: "new-model",
				reasoningEffort: "ultrathink",
			}),
		).toEqual({
			providerId: "anthropic",
			modelId: "new-model",
			reasoningEffort: "ultrathink",
		});
	});

	it("clears a field with null/default and keeps the empty-override marker", () => {
		expect(
			buildTaskAgentSettingsForUpdate(
				{ modelId: "old-model" },
				{
					modelId: null,
					reasoningEffort: "default",
				},
			),
		).toEqual({});
	});

	it("clears everything with null/inherit and returns null", () => {
		expect(
			buildTaskAgentSettingsForUpdate(CURRENT, {
				providerId: null,
				modelId: null,
				reasoningEffort: null,
			}),
		).toBeNull();
	});

	it("accepts arbitrary effort strings on update (opacity proof)", () => {
		expect(buildTaskAgentSettingsForUpdate(undefined, { reasoningEffort: "MAXIMUM_OVERDRIVE" })).toEqual({
			reasoningEffort: "MAXIMUM_OVERDRIVE",
		});
	});
});

describe("shouldWarnOnExplicitAgentId", () => {
	it("is true only when the command names an agent", () => {
		expect(shouldWarnOnExplicitAgentId("kiro")).toBe(true);
		expect(shouldWarnOnExplicitAgentId(undefined)).toBe(false);
		expect(shouldWarnOnExplicitAgentId(null)).toBe(false);
	});
});

describe("warnOnAgentSettingsMechanismGaps", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function captureStderr(): ReturnType<typeof vi.fn> {
		return vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	}

	it("writes no warning when settings are absent", () => {
		const write = captureStderr();
		warnOnAgentSettingsMechanismGaps("kiro", undefined);
		expect(write).not.toHaveBeenCalled();
	});

	it("writes no warning for agents that support the set fields", () => {
		const write = captureStderr();
		warnOnAgentSettingsMechanismGaps("claude", { modelId: "m", reasoningEffort: "high" });
		warnOnAgentSettingsMechanismGaps("codex", { modelId: "m", reasoningEffort: "high" });
		warnOnAgentSettingsMechanismGaps("droid", { modelId: "m", reasoningEffort: "high" });
		warnOnAgentSettingsMechanismGaps("cline", { providerId: "anthropic", modelId: "m", reasoningEffort: "high" });
		warnOnAgentSettingsMechanismGaps("opencode", { providerId: "openrouter", modelId: "m" });
		expect(write).not.toHaveBeenCalled();
	});

	it("warns when kiro receives model, effort, or provider settings", () => {
		const write = captureStderr();
		warnOnAgentSettingsMechanismGaps("kiro", {
			providerId: "anthropic",
			modelId: "some-model",
			reasoningEffort: "high",
		});
		const output = write.mock.calls.map((call) => String(call[0])).join("");
		expect(output).toContain("some-model");
		expect(output).toContain("high");
		expect(output).toContain("anthropic");
	});

	it("warns when gemini receives a reasoning effort setting", () => {
		const write = captureStderr();
		warnOnAgentSettingsMechanismGaps("gemini", { reasoningEffort: "high" });
		const output = write.mock.calls.map((call) => String(call[0])).join("");
		expect(output).toContain("high");
		expect(output).toContain("Gemini CLI");
	});

	it("does not warn for gemini model settings", () => {
		const write = captureStderr();
		warnOnAgentSettingsMechanismGaps("gemini", { modelId: "gemini-2.5-pro" });
		expect(write).not.toHaveBeenCalled();
	});

	it("warns when a provider is set for an agent that never reads it", () => {
		const write = captureStderr();
		warnOnAgentSettingsMechanismGaps("claude", { providerId: "anthropic" });
		const output = write.mock.calls.map((call) => String(call[0])).join("");
		expect(output).toContain("anthropic");
		expect(output).toContain("provider");
	});

	it("does not warn for provider on agents that read one (cline/opencode)", () => {
		const write = captureStderr();
		warnOnAgentSettingsMechanismGaps("cline", { providerId: "anthropic" });
		warnOnAgentSettingsMechanismGaps("opencode", { providerId: "openrouter" });
		expect(write).not.toHaveBeenCalled();
	});
});

describe("resolveSettingsFlag", () => {
	it("returns the generic flag when only it is set", () => {
		expect(resolveSettingsFlag("generic", undefined, "--model", "--cline-model")).toBe("generic");
	});

	it("returns the deprecated alias when only it is set", () => {
		expect(resolveSettingsFlag(undefined, "alias", "--model", "--cline-model")).toBe("alias");
	});

	it("throws when both forms are passed for the same field", () => {
		expect(() => resolveSettingsFlag("generic", "alias", "--model", "--cline-model")).toThrow(
			"Cannot use both --model and the deprecated --cline-model",
		);
	});
});

describe("formatTaskAgentSettings", () => {
	it("emits agentSettings plus a deprecated clineSettings mirror", () => {
		expect(formatTaskAgentSettings({ modelId: "acme-model" })).toEqual({
			agentSettings: { modelId: "acme-model" },
			clineSettings: { modelId: "acme-model" },
		});
	});

	it("emits an empty object when settings are absent", () => {
		expect(formatTaskAgentSettings(undefined)).toEqual({});
	});
});
