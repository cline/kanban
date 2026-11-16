import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";

import { isBinaryAvailableOnPath } from "../../../src/terminal/command-discovery";
import { createTempDir } from "../../utilities/temp-dir";

function writeFakeCommand(binDir: string, command: string): void {
	mkdirSync(binDir, { recursive: true });
	if (process.platform === "win32") {
		const scriptPath = join(binDir, `${command}.cmd`);
		writeFileSync(scriptPath, "@echo off\r\nexit /b 0\r\n", "utf8");
		return;
	}
	const scriptPath = join(binDir, command);
	writeFileSync(scriptPath, "#!/bin/sh\nexit 0\n", "utf8");
	chmodSync(scriptPath, 0o755);
}

function withTemporaryHomeAndPath<T>(
	input: {
		home: string;
		path?: string;
	},
	run: () => T,
): T {
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	const previousPath = process.env.PATH;

	process.env.HOME = input.home;
	process.env.USERPROFILE = input.home;
	if (input.path === undefined) {
		delete process.env.PATH;
	} else {
		process.env.PATH = input.path;
	}

	try {
		return run();
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = previousUserProfile;
		}
		if (previousPath === undefined) {
			delete process.env.PATH;
		} else {
			process.env.PATH = previousPath;
		}
	}
}

describe.sequential("command-discovery", () => {
	it("finds binaries in standard user-local bin directories when PATH omits them", () => {
		if (process.platform === "win32") {
			return;
		}

		const { path: tempHome, cleanup } = createTempDir("kanban-command-discovery-home-");
		try {
			const localBin = join(tempHome, ".local", "bin");
			writeFakeCommand(localBin, "droid");

			withTemporaryHomeAndPath(
				{
					home: tempHome,
					path: ["/usr/bin", "/bin"].join(delimiter),
				},
				() => {
					expect(isBinaryAvailableOnPath("droid")).toBe(true);
				},
			);
		} finally {
			cleanup();
		}
	});
});
