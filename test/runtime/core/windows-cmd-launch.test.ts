import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { shouldUseWindowsCmdLaunch } from "../../../src/core/windows-cmd-launch";

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
});
