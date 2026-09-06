import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildCodexWrapperChildArgs, buildCodexWrapperSpawn } from "../../src/commands/hooks";

describe("buildCodexWrapperChildArgs", () => {
	it("does not inject legacy notify config", () => {
		const args = buildCodexWrapperChildArgs(["exec", "fix the bug"]);

		expect(args).toEqual(["exec", "fix the bug"]);
	});

	it("preserves an explicit notify config without adding another one", () => {
		expect(buildCodexWrapperChildArgs(["-c", 'notify=["echo","custom"]', "exec", "fix the bug"])).toEqual([
			"-c",
			'notify=["echo","custom"]',
			"exec",
			"fix the bug",
		]);
	});

	it("uses ComSpec on Windows for npm shim binaries", () => {
		const launch = buildCodexWrapperSpawn("codex", ["exec", "fix the bug"], "win32", {
			ComSpec: "C:\\Windows\\System32\\cmd.exe",
		});

		expect(launch.binary).toBe("C:\\Windows\\System32\\cmd.exe");
		expect(launch.args[0]).toBe("/d");
		expect(launch.args[1]).toBe("/s");
		expect(launch.args[2]).toBe("/c");
		expect(launch.args[3]).toContain("codex");
		expect(launch.args[3]).toContain("exec");
	});

	it("does not wrap cmd itself on Windows", () => {
		const launch = buildCodexWrapperSpawn("cmd.exe", ["/c", "echo hi"], "win32", {
			ComSpec: "C:\\Windows\\System32\\cmd.exe",
		});

		expect(launch.binary).toBe("cmd.exe");
		expect(launch.args).toEqual(["/c", "echo hi"]);
	});

	it("resolves npm cmd shims to direct node launches on Windows", () => {
		const windowsBinDir = mkdtempSync(join(tmpdir(), "kanban-codex-wrapper-"));
		const nodeModulesBinDir = join(windowsBinDir, "node_modules", "@openai", "codex", "bin");
		mkdirSync(nodeModulesBinDir, { recursive: true });
		writeFileSync(
			join(windowsBinDir, "codex.cmd"),
			[
				"@ECHO off",
				'IF EXIST "%dp0%\\node.exe" (',
				'  SET "_prog=%dp0%\\node.exe"',
				") ELSE (",
				'  SET "_prog=node"',
				")",
				'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
			].join("\r\n"),
		);
		writeFileSync(join(windowsBinDir, "node.exe"), "");
		writeFileSync(join(nodeModulesBinDir, "codex.js"), "");

		try {
			const launch = buildCodexWrapperSpawn("codex", ["exec", "x".repeat(12_000)], "win32", {
				PATH: windowsBinDir,
				PATHEXT: ".com;.exe;.bat;.cmd",
				ComSpec: "C:\\Windows\\System32\\cmd.exe",
			});

			expect(launch.binary).toBe(join(windowsBinDir, "node.exe"));
			expect(launch.args).toEqual([
				join(windowsBinDir, "node_modules", "@openai", "codex", "bin", "codex.js"),
				"exec",
				"x".repeat(12_000),
			]);
		} finally {
			rmSync(windowsBinDir, { recursive: true, force: true });
		}
	});
});
