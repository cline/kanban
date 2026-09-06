import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	resolveWindowsBatchShimLaunch,
	resolveWindowsSpawnLaunch,
	shouldUseWindowsCmdLaunch,
} from "../../../src/core/windows-cmd-launch";

function createWindowsBinary(directory: string, fileName: string): string {
	const filePath = join(directory, fileName);
	writeFileSync(filePath, "");
	return filePath;
}

describe("shouldUseWindowsCmdLaunch", () => {
	const tempDirectories: string[] = [];

	afterEach(() => {
		for (const directory of tempDirectories) {
			rmSync(directory, { recursive: true, force: true });
		}
		tempDirectories.length = 0;
	});

	it("returns false outside Windows", () => {
		expect(shouldUseWindowsCmdLaunch("codex", "darwin")).toBe(false);
	});

	it("returns false for explicit .exe binaries", () => {
		expect(shouldUseWindowsCmdLaunch("codex.exe", "win32")).toBe(false);
	});

	it("returns true for explicit .cmd shims", () => {
		expect(shouldUseWindowsCmdLaunch("codex.cmd", "win32")).toBe(true);
	});

	it("returns false when PATH resolves a bare binary to .exe", () => {
		const tempDirectory = mkdtempSync(join(tmpdir(), "kanban-win-launch-"));
		tempDirectories.push(tempDirectory);
		createWindowsBinary(tempDirectory, "codex.exe");

		expect(
			shouldUseWindowsCmdLaunch("codex", "win32", {
				PATH: tempDirectory,
				PATHEXT: ".com;.exe;.bat;.cmd",
				ComSpec: "C:\\Windows\\System32\\cmd.exe",
			}),
		).toBe(false);
	});

	it("treats Windows env keys case-insensitively when PATH resolves a bare binary to .exe", () => {
		const tempDirectory = mkdtempSync(join(tmpdir(), "kanban-win-launch-"));
		tempDirectories.push(tempDirectory);
		createWindowsBinary(tempDirectory, "codex.exe");

		expect(
			shouldUseWindowsCmdLaunch("codex", "win32", {
				Path: tempDirectory,
				Pathext: ".com;.exe;.bat;.cmd",
				comspec: "C:\\Windows\\System32\\cmd.exe",
			}),
		).toBe(false);
	});

	it("uses defined case-insensitive PATH when duplicate keys include undefined", () => {
		const tempDirectory = mkdtempSync(join(tmpdir(), "kanban-win-launch-"));
		tempDirectories.push(tempDirectory);
		createWindowsBinary(tempDirectory, "codex.exe");

		expect(
			shouldUseWindowsCmdLaunch("codex", "win32", {
				PATH: undefined,
				Path: tempDirectory,
				PATHEXT: ".com;.exe;.bat;.cmd",
				ComSpec: "C:\\Windows\\System32\\cmd.exe",
			}),
		).toBe(false);
	});

	it("returns true when PATH resolves a bare binary to .cmd", () => {
		const tempDirectory = mkdtempSync(join(tmpdir(), "kanban-win-launch-"));
		tempDirectories.push(tempDirectory);
		createWindowsBinary(tempDirectory, "codex.cmd");

		expect(
			shouldUseWindowsCmdLaunch("codex", "win32", {
				PATH: tempDirectory,
				PATHEXT: ".com;.exe;.bat;.cmd",
				ComSpec: "C:\\Windows\\System32\\cmd.exe",
			}),
		).toBe(true);
	});

	it("keeps cmd wrapping fallback when resolution is ambiguous", () => {
		expect(
			shouldUseWindowsCmdLaunch("codex", "win32", {
				PATH: "",
				PATHEXT: ".com;.exe;.bat;.cmd",
				ComSpec: "C:\\Windows\\System32\\cmd.exe",
			}),
		).toBe(true);
	});

	it("resolves npm Node shims to direct node + script launches", () => {
		const tempDirectory = mkdtempSync(join(tmpdir(), "kanban-win-launch-"));
		tempDirectories.push(tempDirectory);
		const shimPath = createWindowsBinary(tempDirectory, "codex.cmd");
		createWindowsBinary(tempDirectory, "node.exe");
		const scriptPath = join(tempDirectory, "node_modules", "@openai", "codex", "bin", "codex.js");
		writeFileSync(
			shimPath,
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

		const resolved = resolveWindowsBatchShimLaunch("codex", ["exec", "x".repeat(12_000)], "win32", {
			PATH: tempDirectory,
			PATHEXT: ".com;.exe;.bat;.cmd",
		});

		expect(resolved).toEqual({
			binary: join(tempDirectory, "node.exe"),
			args: [scriptPath, "exec", "x".repeat(12_000)],
		});
	});

	it("resolves batch shims that forward directly to executables", () => {
		const tempDirectory = mkdtempSync(join(tmpdir(), "kanban-win-launch-"));
		tempDirectories.push(tempDirectory);
		const shimPath = createWindowsBinary(tempDirectory, "claude.cmd");
		const executablePath = join(tempDirectory, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
		writeFileSync(shimPath, `"${tempDirectory}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n`);
		mkdirSync(join(tempDirectory, "node_modules", "@anthropic-ai", "claude-code", "bin"), { recursive: true });
		writeFileSync(executablePath, "");

		const resolved = resolveWindowsBatchShimLaunch("claude", ["--append-system-prompt", "prompt"], "win32", {
			PATH: tempDirectory,
			PATHEXT: ".com;.exe;.bat;.cmd",
		});

		expect(resolved).toEqual({
			binary: executablePath,
			args: ["--append-system-prompt", "prompt"],
		});
	});

	it("falls back when a batch shim points to a missing executable", () => {
		const tempDirectory = mkdtempSync(join(tmpdir(), "kanban-win-launch-"));
		tempDirectories.push(tempDirectory);
		const shimPath = createWindowsBinary(tempDirectory, "claude.cmd");
		writeFileSync(shimPath, `"${tempDirectory}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n`);

		expect(
			resolveWindowsBatchShimLaunch("claude", ["--append-system-prompt", "prompt"], "win32", {
				PATH: tempDirectory,
				PATHEXT: ".com;.exe;.bat;.cmd",
			}),
		).toBeNull();

		expect(
			resolveWindowsSpawnLaunch("claude", ["--append-system-prompt", "prompt"], "win32", {
				PATH: tempDirectory,
				PATHEXT: ".com;.exe;.bat;.cmd",
				ComSpec: "C:\\Windows\\System32\\cmd.exe",
			}),
		).toEqual({
			binary: "C:\\Windows\\System32\\cmd.exe",
			args: ["--append-system-prompt", "prompt"],
			useCmdShell: true,
		});
	});

	it("resolves direct node batch shims to their script entrypoint", () => {
		const tempDirectory = mkdtempSync(join(tmpdir(), "kanban-win-launch-"));
		tempDirectories.push(tempDirectory);
		const shimPath = createWindowsBinary(tempDirectory, "yarn.cmd");
		const bundledNodePath = join(tempDirectory, "node.exe");
		createWindowsBinary(tempDirectory, "node.exe");
		const scriptPath = join(tempDirectory, "node_modules", "yarn", "bin", "yarn.js");
		writeFileSync(shimPath, `"${bundledNodePath}" "${tempDirectory}\\node_modules\\yarn\\bin\\yarn.js" %*\r\n`);

		const resolved = resolveWindowsBatchShimLaunch("yarn", ["dlx", "kanban"], "win32", {
			PATH: tempDirectory,
			PATHEXT: ".com;.exe;.bat;.cmd",
		});

		expect(resolved).toEqual({
			binary: bundledNodePath,
			args: [scriptPath, "dlx", "kanban"],
		});
	});

	it("falls back to cmd shell when a node-based shim cannot resolve node", () => {
		const tempDirectory = mkdtempSync(join(tmpdir(), "kanban-win-launch-"));
		tempDirectories.push(tempDirectory);
		const shimPath = createWindowsBinary(tempDirectory, "pnpm.cmd");
		writeFileSync(shimPath, 'node "%dp0%\\node_modules\\pnpm\\bin\\pnpm.cjs" %*\r\n');

		expect(
			resolveWindowsBatchShimLaunch("pnpm", ["dlx", "kanban"], "win32", {
				PATH: tempDirectory,
				PATHEXT: ".com;.exe;.bat;.cmd",
			}),
		).toBeNull();

		expect(
			resolveWindowsSpawnLaunch("pnpm", ["dlx", "kanban"], "win32", {
				PATH: tempDirectory,
				PATHEXT: ".com;.exe;.bat;.cmd",
				ComSpec: "C:\\Windows\\System32\\cmd.exe",
			}),
		).toEqual({
			binary: "C:\\Windows\\System32\\cmd.exe",
			args: ["dlx", "kanban"],
			useCmdShell: true,
		});
	});
});
