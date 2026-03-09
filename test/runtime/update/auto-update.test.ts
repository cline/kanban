import { describe, expect, it } from "vitest";

import {
	AutoUpdatePackageManager,
	compareVersions,
	detectAutoUpdateInstallation,
	runAutoUpdateCheck,
} from "../../../src/update/auto-update.js";

describe("compareVersions", () => {
	it("supports semantic versions with prerelease values", () => {
		expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
		expect(compareVersions("1.0.1", "1.0.0")).toBeGreaterThan(0);
		expect(compareVersions("1.0.0-nightly.12", "1.0.0")).toBeLessThan(0);
		expect(compareVersions("1.0.0-nightly.12", "1.0.0-nightly.2")).toBeGreaterThan(0);
	});
});

describe("detectAutoUpdateInstallation", () => {
	it("marks workspace-local execution as local and non-updatable", () => {
		const installation = detectAutoUpdateInstallation({
			currentVersion: "1.0.0",
			packageName: "kanban",
			entrypointPath: "/workspace/kanban/dist/cli.js",
			cwd: "/workspace/kanban",
		});

		expect(installation.packageManager).toBe(AutoUpdatePackageManager.LOCAL);
		expect(installation.updateCommand).toBeNull();
	});
});

describe("runAutoUpdateCheck", () => {
	it("spawns a global update when a newer version is available", async () => {
		const spawnedUpdates: Array<{ command: string; args: string[] }> = [];

		await runAutoUpdateCheck({
			currentVersion: "1.0.0",
			packageName: "kanban",
			argv: ["node", "/usr/local/lib/node_modules/kanban/dist/cli.js"],
			cwd: "/Users/saoud/projects/work",
			env: {},
			resolveRealPath: (path) => path,
			fetchLatestVersion: async () => "1.1.0",
			spawnUpdate: (command, args) => {
				spawnedUpdates.push({ command, args });
			},
		});

		expect(spawnedUpdates).toEqual([
			{
				command: "npm",
				args: ["install", "-g", "kanban@latest"],
			},
		]);
	});

	it("checks for updates on each startup without persisted state", async () => {
		let fetchCalls = 0;
		let spawnCalls = 0;

		const options = {
			currentVersion: "1.0.0",
			packageName: "kanban",
			argv: ["node", "/usr/local/lib/node_modules/kanban/dist/cli.js"],
			cwd: "/Users/saoud/projects/work",
			env: {},
			resolveRealPath: (path: string) => path,
			fetchLatestVersion: async () => {
				fetchCalls += 1;
				return "1.1.0";
			},
			spawnUpdate: () => {
				spawnCalls += 1;
			},
		};

		await runAutoUpdateCheck(options);
		await runAutoUpdateCheck(options);

		expect(fetchCalls).toBe(2);
		expect(spawnCalls).toBe(2);
	});

	it("skips update checks when KANBAN_NO_AUTO_UPDATE is set", async () => {
		let fetchCalled = false;

		await runAutoUpdateCheck({
			currentVersion: "1.0.0",
			packageName: "kanban",
			argv: ["node", "/usr/local/lib/node_modules/kanban/dist/cli.js"],
			cwd: "/Users/saoud/projects/work",
			env: { KANBAN_NO_AUTO_UPDATE: "1" },
			resolveRealPath: (path) => path,
			fetchLatestVersion: async () => {
				fetchCalled = true;
				return "1.1.0";
			},
			spawnUpdate: () => {
				throw new Error("should not spawn");
			},
		});

		expect(fetchCalled).toBe(false);
	});
});
