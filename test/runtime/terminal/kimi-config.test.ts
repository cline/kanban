import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	buildKimiKanbanConfigContent,
	getKimiDefaultConfigPath,
	type KimiHookCommandBuilder,
} from "../../../src/terminal/kimi-config";

const originalKimiCodeHome = process.env.KIMI_CODE_HOME;
const originalKimiShareDir = process.env.KIMI_SHARE_DIR;

const buildCommand: KimiHookCommandBuilder = (event, metadata) =>
	[event, metadata.source, metadata.hookEventName, metadata.activityText ?? ""]
		.filter((part) => part !== "")
		.join(":");

function countOccurrences(content: string, pattern: RegExp): number {
	return content.match(pattern)?.length ?? 0;
}

afterEach(() => {
	if (originalKimiShareDir === undefined) {
		delete process.env.KIMI_SHARE_DIR;
	} else {
		process.env.KIMI_SHARE_DIR = originalKimiShareDir;
	}
	if (originalKimiCodeHome === undefined) {
		delete process.env.KIMI_CODE_HOME;
	} else {
		process.env.KIMI_CODE_HOME = originalKimiCodeHome;
	}
});

describe("buildKimiKanbanConfigContent", () => {
	it("writes one top-level hooks array before TOML tables", () => {
		const config = buildKimiKanbanConfigContent(
			['default_model = ""', "hooks = []", "telemetry = true", "", "[models]", "", "[providers]"].join("\n"),
			buildCommand,
		);

		expect(countOccurrences(config, /^hooks = \[/gm)).toBe(1);
		expect(config).not.toContain("[[hooks]]");
		expect(config.indexOf("hooks = [")).toBeLessThan(config.indexOf("[models]"));
		expect(config).toContain('event = "UserPromptSubmit"');
		expect(config).toContain('command = "to_in_progress:kimi:UserPromptSubmit"');
	});

	it("adds hooks when the user config has no hooks key", () => {
		const config = buildKimiKanbanConfigContent(
			['default_model = "kimi-code/kimi-for-coding"', "telemetry = false", "", "[models]"].join("\n"),
			buildCommand,
		);

		expect(config).toContain('default_model = "kimi-code/kimi-for-coding"');
		expect(config).toContain("hooks = [");
		expect(config.indexOf("hooks = [")).toBeLessThan(config.indexOf("[models]"));
	});

	it("preserves user hooks and appends Kanban hooks in the same array", () => {
		const config = buildKimiKanbanConfigContent(
			[
				"hooks = [",
				'  { event = "PostToolUse", command = "echo user-hook", timeout = 5 }',
				"]",
				"",
				"[models]",
			].join("\n"),
			buildCommand,
		);

		expect(config).toContain('{ event = "PostToolUse", command = "echo user-hook", timeout = 5 },');
		expect(config.indexOf("echo user-hook")).toBeLessThan(config.indexOf("# <kanban-kimi-hooks>"));
		expect(countOccurrences(config, /^hooks = \[/gm)).toBe(1);
	});

	it("adds a separator comma before a trailing comment on the last user hook", () => {
		const config = buildKimiKanbanConfigContent(
			[
				"hooks = [",
				'  { event = "Stop", command = "echo done", timeout = 5 } # stop hook',
				"]",
				"",
				"[models]",
			].join("\n"),
			buildCommand,
		);

		expect(config).toContain('{ event = "Stop", command = "echo done", timeout = 5 }, # stop hook');
		expect(config).not.toContain("# stop hook,");
		expect(config).toContain('event = "UserPromptSubmit"');
	});

	it("does not treat indented inline array entries as TOML table headers", () => {
		const config = buildKimiKanbanConfigContent(
			["allowed_values = [", '  ["inner", "value"]', "]", "", "[models]"].join("\n"),
			buildCommand,
		);

		expect(config).toContain(["allowed_values = [", '  ["inner", "value"]', "]", "hooks = ["].join("\n"));
		expect(config.indexOf("hooks = [")).toBeLessThan(config.indexOf("[models]"));
	});

	it("replaces an existing Kanban-managed hook region", () => {
		const config = buildKimiKanbanConfigContent(
			[
				"hooks = [",
				'  { event = "PostToolUse", command = "echo user-hook", timeout = 5 },',
				"  # <kanban-kimi-hooks>",
				'  { event = "Stop", command = "old-kanban-hook", timeout = 5 },',
				"  # </kanban-kimi-hooks>",
				"]",
			].join("\n"),
			buildCommand,
		);

		expect(config).toContain("echo user-hook");
		expect(config).not.toContain("old-kanban-hook");
		expect(countOccurrences(config, /# <kanban-kimi-hooks>/g)).toBe(1);
		expect(countOccurrences(config, /# <\/kanban-kimi-hooks>/g)).toBe(1);
	});

	it("keeps bracket and comment characters inside existing hook strings", () => {
		const config = buildKimiKanbanConfigContent(
			["hooks = [", '  { event = "Stop", command = "echo [ok] # not a comment", timeout = 5 }', "]"].join("\n"),
			buildCommand,
		);

		expect(config).toContain('command = "echo [ok] # not a comment"');
		expect(config).toContain('event = "UserPromptSubmit"');
	});
});

describe("getKimiDefaultConfigPath", () => {
	it("uses KIMI_SHARE_DIR when provided", () => {
		process.env.KIMI_SHARE_DIR = "/tmp/custom-kimi";

		expect(getKimiDefaultConfigPath(undefined)).toBe(join("/tmp/custom-kimi", "config.toml"));
		expect(getKimiDefaultConfigPath({ KIMI_SHARE_DIR: "/tmp/env-kimi" })).toBe(join("/tmp/env-kimi", "config.toml"));
	});

	it("falls back to KIMI_CODE_HOME for older local overrides", () => {
		process.env.KIMI_CODE_HOME = "/tmp/custom-kimi";

		expect(getKimiDefaultConfigPath(undefined)).toBe(join("/tmp/custom-kimi", "config.toml"));
		expect(getKimiDefaultConfigPath({ KIMI_CODE_HOME: "/tmp/env-kimi" })).toBe(join("/tmp/env-kimi", "config.toml"));
	});
});
