import { afterEach, describe, expect, it } from "vitest";

import { resolveInteractiveShellCommand } from "../../../src/core/shell";

const originalPlatform = process.platform;
const originalShell = process.env.SHELL;

function setPlatform(value: NodeJS.Platform): void {
	Object.defineProperty(process, "platform", {
		value,
		configurable: true,
	});
}

describe("resolveInteractiveShellCommand", () => {
	afterEach(() => {
		setPlatform(originalPlatform);
		if (originalShell === undefined) {
			delete process.env.SHELL;
		} else {
			process.env.SHELL = originalShell;
		}
	});

	it("uses SHELL env when set on unix", () => {
		setPlatform("darwin");
		process.env.SHELL = "/bin/fish";
		const result = resolveInteractiveShellCommand();
		expect(result.binary).toBe("/bin/fish");
		expect(result.args).toEqual(["-i"]);
	});

	it("falls back to /bin/zsh on macOS when SHELL is unset", () => {
		setPlatform("darwin");
		delete process.env.SHELL;
		const result = resolveInteractiveShellCommand();
		expect(result.binary).toBe("/bin/zsh");
		expect(result.args).toEqual(["-i"]);
	});

	it("falls back to /bin/bash on Linux when SHELL is unset", () => {
		setPlatform("linux");
		delete process.env.SHELL;
		const result = resolveInteractiveShellCommand();
		expect(result.binary).toBe("/bin/bash");
		expect(result.args).toEqual(["-i"]);
	});

	it("trims whitespace from SHELL env", () => {
		setPlatform("darwin");
		process.env.SHELL = "  /bin/zsh  ";
		const result = resolveInteractiveShellCommand();
		expect(result.binary).toBe("/bin/zsh");
	});

	it("treats empty SHELL as unset on macOS", () => {
		setPlatform("darwin");
		process.env.SHELL = "   ";
		const result = resolveInteractiveShellCommand();
		expect(result.binary).toBe("/bin/zsh");
	});

	it("returns an absolute path for the fallback shell", () => {
		setPlatform("darwin");
		delete process.env.SHELL;
		const result = resolveInteractiveShellCommand();
		expect(result.binary.startsWith("/")).toBe(true);
	});
});
