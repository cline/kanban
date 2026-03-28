import { afterEach, describe, expect, it } from "vitest";

import {
	AutoUpdatePackageManager,
	compareVersions,
	detectAutoUpdateInstallation,
	resolveUpdateCommandForPlatform,
	runAutoUpdateCheck,
	runPendingAutoUpdateOnShutdown,
} from "../../../src/update/auto-update";

function normalizePath(value: string): string {
	return value.replaceAll("\\", "/");
}

function expectPathEndsWith(actualPath: string | undefined, expectedSuffix: string): void {
	expect(actualPath).toBeDefined();
	expect(normalizePath(actualPath ?? "").endsWith(expectedSuffix)).toBe(true);
}

afterEach(() => {
	runPendingAutoUpdateOnShutdown({
		spawnUpdate: () => {},
		log: () => {},
	});
});

describe("compareVersions", () => {
	it("supports semantic versions with prerelease values", () => {
		expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
		expect(compareVersions("1.0.1", "1.0.0")).toBeGreaterThan(0);
		expect(compareVersions("1.0.0-nightly.12", "1.0.0")).toBeLessThan(0);
		expect(compareVersions("1.0.0-nightly.12", "1.0.0-nightly.2")).toBeGreaterThan(0);
	});
});

describe("resolveUpdateCommandForPlatform", () => {
	it("keeps command names unchanged on non-windows platforms", () => {
		expect(resolveUpdateCommandForPlatform("npm", "darwin")).toBe("npm");
		expect(resolveUpdateCommandForPlatform("pnpm", "linux")).toBe("pnpm");
	});

	it("maps package manager commands to .cmd on windows", () => {
		expect(resolveUpdateCommandForPlatform("npm", "win32")).toBe("npm.cmd");
		expect(resolveUpdateCommandForPlatform("pnpm", "win32")).toBe("pnpm.cmd");
		expect(resolveUpdateCommandForPlatform("yarn", "win32")).toBe("yarn.cmd");
	});

	it("does not rewrite non-cmd commands on windows", () => {
		expect(resolveUpdateCommandForPlatform("bun", "win32")).toBe("bun");
		expect(resolveUpdateCommandForPlatform(process.execPath, "win32")).toBe(process.execPath);
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
		expect(installation.updateTiming).toBe("startup");
	});

	it("marks npx installs for shutdown-time cache refresh", () => {
		const installation = detectAutoUpdateInstallation({
			currentVersion: "1.0.0",
			packageName: "kanban",
			entrypointPath: "/Users/saoud/.npm/_npx/593b71878a7c70f2/node_modules/kanban/dist/cli.js",
			cwd: "/Users/saoud/projects/work",
		});

		expect(installation.packageManager).toBe(AutoUpdatePackageManager.NPX);
		expect(installation.updateTiming).toBe("shutdown");
		expect(installation.updateCommand?.command).toBe(process.execPath);
		expect(installation.updateCommand?.args[0]).toBe("-e");
		expect(typeof installation.updateCommand?.args[1]).toBe("string");
		expectPathEndsWith(installation.updateCommand?.args[2], "/Users/saoud/.npm/_npx/593b71878a7c70f2");
	});

	it("marks npm-cache npx installs for shutdown-time cache refresh", () => {
		const installation = detectAutoUpdateInstallation({
			currentVersion: "1.0.0",
			packageName: "kanban",
			entrypointPath: "/Users/saoud/AppData/Local/npm-cache/_npx/593b71878a7c70f2/node_modules/kanban/dist/cli.js",
			cwd: "/Users/saoud/projects/work",
		});

		expect(installation.packageManager).toBe(AutoUpdatePackageManager.NPX);
		expect(installation.updateTiming).toBe("shutdown");
		expect(installation.updateCommand?.command).toBe(process.execPath);
		expect(installation.updateCommand?.args[0]).toBe("-e");
		expect(typeof installation.updateCommand?.args[1]).toBe("string");
		expectPathEndsWith(
			installation.updateCommand?.args[2],
			"/Users/saoud/AppData/Local/npm-cache/_npx/593b71878a7c70f2",
		);
	});

	it("marks pnpm dlx installs for shutdown-time cache refresh", () => {
		const installation = detectAutoUpdateInstallation({
			currentVersion: "1.0.0",
			packageName: "kanban",
			entrypointPath:
				"/Users/saoud/Library/Caches/pnpm/dlx/82fa34f6d8482ef2103aa281bbfd9bc42aeec4c8b99d8b1d6bc4653f9d4d179d/19cd9b46385-11271/node_modules/.pnpm/kanban@1.0.0/node_modules/kanban/dist/cli.js",
			cwd: "/Users/saoud/projects/work",
		});

		expect(installation.packageManager).toBe(AutoUpdatePackageManager.PNPM);
		expect(installation.updateTiming).toBe("shutdown");
		expect(installation.updateCommand?.command).toBe(process.execPath);
		expect(installation.updateCommand?.args[0]).toBe("-e");
		expect(typeof installation.updateCommand?.args[1]).toBe("string");
		expectPathEndsWith(
			installation.updateCommand?.args[2],
			"/Users/saoud/Library/Caches/pnpm/dlx/82fa34f6d8482ef2103aa281bbfd9bc42aeec4c8b99d8b1d6bc4653f9d4d179d/19cd9b46385-11271",
		);
	});

	it("marks bunx installs for shutdown-time cache refresh", () => {
		const installation = detectAutoUpdateInstallation({
			currentVersion: "1.0.0",
			packageName: "kanban",
			entrypointPath: "/private/tmp/bunx-501-kanban@1.0.0/node_modules/kanban/dist/cli.js",
			cwd: "/Users/saoud/projects/work",
		});

		expect(installation.packageManager).toBe(AutoUpdatePackageManager.BUN);
		expect(installation.updateTiming).toBe("shutdown");
		expect(installation.updateCommand?.command).toBe(process.execPath);
		expect(installation.updateCommand?.args[0]).toBe("-e");
		expect(typeof installation.updateCommand?.args[1]).toBe("string");
		expectPathEndsWith(installation.updateCommand?.args[2], "/private/tmp/bunx-501-kanban@1.0.0");
	});

	it("marks yarn dlx installs for shutdown-time cache refresh", () => {
		const installation = detectAutoUpdateInstallation({
			currentVersion: "1.0.0",
			packageName: "kanban",
			entrypointPath:
				"/private/var/folders/v5/vpxh_439455fv8f_y_55m8q00000gn/T/xfs-bf17b212/dlx-39615/.yarn/cache/kanban-npm-1.0.0-abcdef1234.zip/node_modules/kanban/dist/cli.js",
			cwd: "/Users/saoud/projects/work",
		});

		expect(installation.packageManager).toBe(AutoUpdatePackageManager.YARN);
		expect(installation.updateTiming).toBe("shutdown");
		expect(installation.updateCommand?.command).toBe(process.execPath);
		expect(installation.updateCommand?.args[0]).toBe("-e");
		expect(typeof installation.updateCommand?.args[1]).toBe("string");
		expectPathEndsWith(
			installation.updateCommand?.args[2],
			"/private/var/folders/v5/vpxh_439455fv8f_y_55m8q00000gn/T/xfs-bf17b212/dlx-39615",
		);
	});

	it("treats workspace-local paths as local before transient heuristics", () => {
		const installation = detectAutoUpdateInstallation({
			currentVersion: "1.0.0",
			packageName: "kanban",
			entrypointPath: "/Users/saoud/projects/work/.npm/_npx/demo/node_modules/kanban/dist/cli.js",
			cwd: "/Users/saoud/projects/work",
		});

		expect(installation.packageManager).toBe(AutoUpdatePackageManager.LOCAL);
		expect(installation.updateCommand).toBeNull();
		expect(installation.updateTiming).toBe("startup");
	});

	it("fails closed for malformed npx-style paths", () => {
		const installation = detectAutoUpdateInstallation({
			currentVersion: "1.0.0",
			packageName: "kanban",
			entrypointPath: "/Users/saoud/.npm/_npx/node_modules/kanban/dist/cli.js",
			cwd: "/Users/saoud/projects/work",
		});

		expect(installation.packageManager).toBe(AutoUpdatePackageManager.UNKNOWN);
		expect(installation.updateCommand).toBeNull();
		expect(installation.updateTiming).toBe("startup");
	});

	it("fails closed for malformed npm-cache npx-style paths", () => {
		const installation = detectAutoUpdateInstallation({
			currentVersion: "1.0.0",
			packageName: "kanban",
			entrypointPath: "/Users/saoud/AppData/Local/npm-cache/_npx/node_modules/kanban/dist/cli.js",
			cwd: "/Users/saoud/projects/work",
		});

		expect(installation.packageManager).toBe(AutoUpdatePackageManager.UNKNOWN);
		expect(installation.updateCommand).toBeNull();
		expect(installation.updateTiming).toBe("startup");
	});

	it("fails closed for malformed pnpm dlx paths", () => {
		const installation = detectAutoUpdateInstallation({
			currentVersion: "1.0.0",
			packageName: "kanban",
			entrypointPath: "/Users/saoud/Library/Caches/pnpm/dlx/hashonly/node_modules/kanban/dist/cli.js",
			cwd: "/Users/saoud/projects/work",
		});

		expect(installation.packageManager).toBe(AutoUpdatePackageManager.UNKNOWN);
		expect(installation.updateCommand).toBeNull();
		expect(installation.updateTiming).toBe("startup");
	});

	it("fails closed for transient-looking paths that are not kanban", () => {
		const installation = detectAutoUpdateInstallation({
			currentVersion: "1.0.0",
			packageName: "kanban",
			entrypointPath: "/private/tmp/bunx-501-otherpkg@1.0.0/node_modules/otherpkg/dist/cli.js",
			cwd: "/Users/saoud/projects/work",
		});

		expect(installation.packageManager).toBe(AutoUpdatePackageManager.UNKNOWN);
		expect(installation.updateCommand).toBeNull();
		expect(installation.updateTiming).toBe("startup");
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

	it("schedules transient cache refresh until shutdown", async () => {
		const spawnedUpdates: Array<{ command: string; args: string[] }> = [];

		await runAutoUpdateCheck({
			currentVersion: "1.0.0",
			packageName: "kanban",
			argv: ["node", "/Users/saoud/.npm/_npx/593b71878a7c70f2/node_modules/kanban/dist/cli.js"],
			cwd: "/Users/saoud/projects/work",
			env: {},
			resolveRealPath: (path) => path,
			fetchLatestVersion: async () => "1.1.0",
			spawnUpdate: (command, args) => {
				spawnedUpdates.push({ command, args });
			},
		});

		expect(spawnedUpdates).toEqual([]);
	});

	it("flushes the pending transient cache refresh during shutdown", async () => {
		const spawnedUpdates: Array<{ command: string; args: string[] }> = [];
		const messages: string[] = [];

		await runAutoUpdateCheck({
			currentVersion: "1.0.0",
			packageName: "kanban",
			argv: ["node", "/Users/saoud/.npm/_npx/593b71878a7c70f2/node_modules/kanban/dist/cli.js"],
			cwd: "/Users/saoud/projects/work",
			env: {},
			resolveRealPath: (path) => path,
			fetchLatestVersion: async () => "1.1.0",
			spawnUpdate: () => {
				throw new Error("transient update should not spawn immediately");
			},
		});

		runPendingAutoUpdateOnShutdown({
			spawnUpdate: (command, args) => {
				spawnedUpdates.push({ command, args });
			},
			log: (message) => {
				messages.push(message);
			},
		});

		expect(messages).toEqual(["New version 1.1.0 detected. Refreshing cached Kanban for next launch."]);
		expect(spawnedUpdates).toHaveLength(1);
		expect(spawnedUpdates[0]?.command).toBe(process.execPath);
		expect(spawnedUpdates[0]?.args[0]).toBe("-e");
		expect(typeof spawnedUpdates[0]?.args[1]).toBe("string");
		expectPathEndsWith(spawnedUpdates[0]?.args[2], "/Users/saoud/.npm/_npx/593b71878a7c70f2");
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
