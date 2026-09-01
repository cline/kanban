import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	buildGenproProviderDiscoveryEnvironment,
	resolveGenproExecutable,
} from "../../../src/terminal/genpro-launcher";

let temporaryRoot: string | null = null;

function executable(name: string): string {
	temporaryRoot ??= mkdtempSync(join(tmpdir(), "kanban-genpro-launcher-"));
	const path = join(temporaryRoot, name);
	writeFileSync(path, "#!/bin/sh\n", { mode: 0o700 });
	chmodSync(path, 0o700);
	return path;
}

afterEach(() => {
	if (temporaryRoot) {
		rmSync(temporaryRoot, { recursive: true, force: true });
		temporaryRoot = null;
	}
});

describe("GenPro launcher resolution", () => {
	it("fails clearly when the configured launcher is missing or unusable", () => {
		expect(() => resolveGenproExecutable(undefined, { KANBAN_GENPRO_EXECUTABLE: "" })).toThrow(
			"must be a non-empty absolute executable path",
		);
		expect(() =>
			resolveGenproExecutable(undefined, { KANBAN_GENPRO_EXECUTABLE: "/missing/genpro-supervisor-adapter" }),
		).toThrow("does not identify an accessible executable");
	});

	it("resolves an explicit executable and a PATH-discoverable executable", () => {
		const launcher = executable("genpro-supervisor-adapter");
		expect(resolveGenproExecutable(undefined, { KANBAN_GENPRO_EXECUTABLE: launcher })).toBe(launcher);
		expect(resolveGenproExecutable(undefined, { PATH: temporaryRoot ?? "" })).toBe(launcher);
	});

	it("prepends only the configured Codex directory to the GenPro child PATH", () => {
		const codex = executable(process.platform === "win32" ? "codex.exe" : "codex");
		const result = buildGenproProviderDiscoveryEnvironment({
			KANBAN_GENPRO_CODEX_EXECUTABLE: codex,
			PATH: "/checkout/node_modules/.bin:/usr/bin",
		});
		expect(result).toEqual({
			PATH: `${temporaryRoot}${delimiter}/checkout/node_modules/.bin:/usr/bin`,
		});
	});

	it("rejects a missing or ambiguously named Codex executable", () => {
		expect(() =>
			buildGenproProviderDiscoveryEnvironment({ KANBAN_GENPRO_CODEX_EXECUTABLE: "relative/codex" }),
		).toThrow("must be an absolute executable path");
		const other = executable("not-codex");
		expect(() => buildGenproProviderDiscoveryEnvironment({ KANBAN_GENPRO_CODEX_EXECUTABLE: other })).toThrow(
			"must identify an executable named",
		);
	});
});
