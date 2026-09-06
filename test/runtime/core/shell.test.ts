import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	detectAvailableShells,
	getInteractiveShellArgs,
	resolveInteractiveShellCommand,
} from "../../../src/core/shell";
import { createTempDir } from "../../utilities/temp-dir";

function withEnv<T>(overrides: Record<string, string | undefined>, run: () => T): T {
	const previous = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(overrides)) {
		previous.set(key, process.env[key]);
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	try {
		return run();
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
}

function writeFakeShell(binDir: string, name: string): string {
	mkdirSync(binDir, { recursive: true });
	if (process.platform === "win32") {
		const filePath = join(binDir, `${name}.exe`);
		writeFileSync(filePath, "");
		return filePath;
	}
	const filePath = join(binDir, name);
	writeFileSync(filePath, "#!/bin/sh\nexit 0\n");
	chmodSync(filePath, 0o755);
	return filePath;
}

describe("getInteractiveShellArgs", () => {
	it("passes no flags to cmd", () => {
		expect(getInteractiveShellArgs("cmd")).toEqual([]);
		expect(getInteractiveShellArgs("cmd.exe")).toEqual([]);
		expect(getInteractiveShellArgs("C:\\Windows\\System32\\cmd.exe")).toEqual([]);
	});

	it("passes -NoLogo to PowerShell family shells", () => {
		expect(getInteractiveShellArgs("powershell.exe")).toEqual(["-NoLogo"]);
		expect(getInteractiveShellArgs("pwsh")).toEqual(["-NoLogo"]);
		expect(getInteractiveShellArgs("/usr/local/bin/pwsh")).toEqual(["-NoLogo"]);
	});

	it("passes -i to POSIX shells on every platform", () => {
		expect(getInteractiveShellArgs("bash")).toEqual(["-i"]);
		expect(getInteractiveShellArgs("/bin/zsh")).toEqual(["-i"]);
		expect(getInteractiveShellArgs("fish")).toEqual(["-i"]);
		expect(getInteractiveShellArgs("bash.exe")).toEqual(["-i"]);
	});
});

describe("resolveInteractiveShellCommand", () => {
	it("uses the preferred shell when it is available on PATH", () => {
		const { path: tempBin, cleanup } = createTempDir("kanban-shell-preferred-");
		try {
			writeFakeShell(tempBin, "zsh");
			withEnv({ PATH: tempBin }, () => {
				const resolved = resolveInteractiveShellCommand("zsh");
				expect(resolved.binary).toBe("zsh");
				expect(resolved.args).toEqual(["-i"]);
			});
		} finally {
			cleanup();
		}
	});

	it("uses a preferred shell given as an absolute path", () => {
		const { path: tempBin, cleanup } = createTempDir("kanban-shell-preferred-path-");
		try {
			const shellPath = writeFakeShell(tempBin, "fish");
			const resolved = resolveInteractiveShellCommand(shellPath);
			expect(resolved.binary).toBe(shellPath);
			expect(resolved.args).toEqual(["-i"]);
		} finally {
			cleanup();
		}
	});

	it("falls back to the environment shell when the preferred shell is unavailable", () => {
		const fallback = resolveInteractiveShellCommand();
		expect(resolveInteractiveShellCommand("definitely-not-a-shell-xyz")).toEqual(fallback);
	});

	it("falls back to the environment shell for null, undefined, and blank preferences", () => {
		const fallback = resolveInteractiveShellCommand();
		expect(resolveInteractiveShellCommand(null)).toEqual(fallback);
		expect(resolveInteractiveShellCommand(undefined)).toEqual(fallback);
		expect(resolveInteractiveShellCommand("   ")).toEqual(fallback);
	});

	it.runIf(process.platform === "win32")("uses COMSPEC when no preference is set on Windows", () => {
		withEnv({ COMSPEC: "C:\\Windows\\System32\\cmd.exe" }, () => {
			expect(resolveInteractiveShellCommand()).toEqual({
				binary: "C:\\Windows\\System32\\cmd.exe",
				args: [],
			});
		});
	});

	it.runIf(process.platform !== "win32")("uses SHELL when no preference is set on POSIX", () => {
		withEnv({ SHELL: "/bin/zsh" }, () => {
			expect(resolveInteractiveShellCommand()).toEqual({
				binary: "/bin/zsh",
				args: ["-i"],
			});
		});
	});
});

describe("detectAvailableShells", () => {
	it.runIf(process.platform === "win32")("detects Windows shells and dedupes COMSPEC by family", () => {
		const { path: tempBin, cleanup } = createTempDir("kanban-shell-detect-");
		try {
			const comspecPath = writeFakeShell(tempBin, "cmd");
			writeFakeShell(tempBin, "pwsh");
			withEnv({ PATH: tempBin, COMSPEC: comspecPath }, () => {
				const detected = detectAvailableShells();
				expect(detected).toEqual([comspecPath, "pwsh"]);
			});
		} finally {
			cleanup();
		}
	});

	it.runIf(process.platform !== "win32")("detects POSIX shells and dedupes SHELL by family", () => {
		const { path: tempBin, cleanup } = createTempDir("kanban-shell-detect-");
		try {
			const shellPath = writeFakeShell(tempBin, "zsh");
			writeFakeShell(tempBin, "bash");
			withEnv({ PATH: tempBin, SHELL: shellPath }, () => {
				const detected = detectAvailableShells();
				expect(detected).toEqual([shellPath, "bash"]);
			});
		} finally {
			cleanup();
		}
	});

	it("omits shells that are not available on PATH", () => {
		const { path: tempBin, cleanup } = createTempDir("kanban-shell-detect-empty-");
		try {
			withEnv(
				{
					PATH: join(tempBin, "empty") + delimiter,
					SHELL: undefined,
					COMSPEC: undefined,
				},
				() => {
					expect(detectAvailableShells()).toEqual([]);
				},
			);
		} finally {
			cleanup();
		}
	});
});
