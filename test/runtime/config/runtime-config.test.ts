import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	loadRuntimeConfig,
	pickBestInstalledAgentIdFromDetected,
	saveRuntimeConfig,
	updateRuntimeConfig,
} from "../../../src/runtime/config/runtime-config.js";
import { createTempDir } from "../../utilities/temp-dir.js";

function withTemporaryEnv<T>(
	input: {
		home: string;
		pathPrefix?: string;
		replacePath?: boolean;
	},
	run: () => Promise<T>,
): Promise<T> {
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	const previousPath = process.env.PATH;
	process.env.HOME = input.home;
	process.env.USERPROFILE = input.home;
	if (input.pathPrefix) {
		process.env.PATH = input.replacePath
			? input.pathPrefix
			: previousPath
				? `${input.pathPrefix}${delimiter}${previousPath}`
				: input.pathPrefix;
	}
	return run().finally(() => {
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
		if (input.pathPrefix) {
			if (previousPath === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previousPath;
			}
		}
	});
}

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

describe.sequential("runtime-config auto agent selection", () => {
	it("selects agents using the configured priority order", () => {
		expect(pickBestInstalledAgentIdFromDetected(["codex", "opencode", "gemini"])).toBe("codex");
		expect(pickBestInstalledAgentIdFromDetected(["opencode", "gemini", "cline"])).toBe("opencode");
		expect(pickBestInstalledAgentIdFromDetected(["gemini", "cline"])).toBe("gemini");
		expect(pickBestInstalledAgentIdFromDetected(["cline"])).toBe("cline");
		expect(pickBestInstalledAgentIdFromDetected([])).toBeNull();
	});

	it("auto-selects and persists when unset", async () => {
		if (process.platform === "win32") {
			return;
		}
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanbanana-home-runtime-config-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanbanana-project-runtime-config-");
		const { path: tempBin, cleanup: cleanupBin } = createTempDir("kanbanana-bin-runtime-config-");

		try {
			writeFakeCommand(tempBin, "opencode");
			writeFakeCommand(tempBin, "codex");
			writeFakeCommand(tempBin, "gemini");

			const previousShell = process.env.SHELL;
			try {
				process.env.SHELL = "/definitely-not-a-shell";
				const isolatedPath = `${tempBin}${delimiter}/usr/bin${delimiter}/bin`;
				await withTemporaryEnv({ home: tempHome, pathPrefix: isolatedPath, replacePath: true }, async () => {
					const state = await loadRuntimeConfig(tempProject);
					expect(state.selectedAgentId).toBe("codex");
					const persisted = JSON.parse(readFileSync(join(tempHome, ".kanbanana", "config.json"), "utf8")) as {
						selectedAgentId?: string;
						readyForReviewNotificationsEnabled?: boolean;
						commitLocalPromptTemplate?: string;
						commitWorktreePromptTemplate?: string;
						openPrLocalPromptTemplate?: string;
						openPrWorktreePromptTemplate?: string;
					};
					expect(persisted.selectedAgentId).toBe("codex");
					expect(persisted.readyForReviewNotificationsEnabled).toBeUndefined();
					expect(persisted.commitLocalPromptTemplate).toBeUndefined();
					expect(persisted.commitWorktreePromptTemplate).toBeUndefined();
					expect(persisted.openPrLocalPromptTemplate).toBeUndefined();
					expect(persisted.openPrWorktreePromptTemplate).toBeUndefined();

					const reloadedState = await loadRuntimeConfig(tempProject);
					expect(reloadedState.selectedAgentId).toBe("codex");
				});
			} finally {
				if (previousShell === undefined) {
					delete process.env.SHELL;
				} else {
					process.env.SHELL = previousShell;
				}
			}
		} finally {
			cleanupBin();
			cleanupProject();
			cleanupHome();
		}
	});

	it("does not write config when no supported CLI is detected", async () => {
		if (process.platform === "win32") {
			return;
		}
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanbanana-home-runtime-config-default-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanbanana-project-runtime-config-default-");
		const { path: tempBin, cleanup: cleanupBin } = createTempDir("kanbanana-bin-runtime-config-default-");

		try {
			const previousShell = process.env.SHELL;
			try {
				process.env.SHELL = "/definitely-not-a-shell";
				await withTemporaryEnv({ home: tempHome, pathPrefix: tempBin, replacePath: true }, async () => {
					const state = await loadRuntimeConfig(tempProject);
					expect(state.selectedAgentId).toBe("claude");
					expect(existsSync(join(tempHome, ".kanbanana", "config.json"))).toBe(false);
				});
			} finally {
				if (previousShell === undefined) {
					delete process.env.SHELL;
				} else {
					process.env.SHELL = previousShell;
				}
			}
		} finally {
			cleanupBin();
			cleanupProject();
			cleanupHome();
		}
	});

	it("does not override a previously configured agent", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanbanana-home-runtime-config-set-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanbanana-project-runtime-config-set-");
		const { path: tempBin, cleanup: cleanupBin } = createTempDir("kanbanana-bin-runtime-config-set-");

		try {
			writeFakeCommand(tempBin, "claude");
			writeFakeCommand(tempBin, "codex");

			const runtimeConfigDir = join(tempHome, ".kanbanana");
			mkdirSync(runtimeConfigDir, { recursive: true });
			writeFileSync(
				join(runtimeConfigDir, "config.json"),
				JSON.stringify(
					{
						selectedAgentId: "gemini",
					},
					null,
					2,
				),
				"utf8",
			);

			await withTemporaryEnv({ home: tempHome, pathPrefix: tempBin }, async () => {
				const state = await loadRuntimeConfig(tempProject);
				expect(state.selectedAgentId).toBe("gemini");
			});
		} finally {
			cleanupBin();
			cleanupProject();
			cleanupHome();
		}
	});

	it("does not auto-select when global config file already exists without selected agent", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanbanana-home-runtime-config-existing-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanbanana-project-runtime-config-existing-",
		);
		const { path: tempBin, cleanup: cleanupBin } = createTempDir("kanbanana-bin-runtime-config-existing-");

		try {
			writeFakeCommand(tempBin, "codex");

			const runtimeConfigDir = join(tempHome, ".kanbanana");
			mkdirSync(runtimeConfigDir, { recursive: true });
			writeFileSync(
				join(runtimeConfigDir, "config.json"),
				JSON.stringify(
					{
						readyForReviewNotificationsEnabled: true,
					},
					null,
					2,
				),
				"utf8",
			);

			await withTemporaryEnv({ home: tempHome, pathPrefix: tempBin }, async () => {
				const state = await loadRuntimeConfig(tempProject);
				expect(state.selectedAgentId).toBe("claude");
			});
		} finally {
			cleanupBin();
			cleanupProject();
			cleanupHome();
		}
	});

	it("save omits default keys when they were not previously set", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanbanana-home-runtime-config-omit-defaults-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanbanana-project-runtime-config-omit-defaults-",
		);

		try {
			const runtimeConfigDir = join(tempHome, ".kanbanana");
			mkdirSync(runtimeConfigDir, { recursive: true });
			writeFileSync(join(runtimeConfigDir, "config.json"), "{}", "utf8");

			await withTemporaryEnv({ home: tempHome }, async () => {
				const current = await loadRuntimeConfig(tempProject);
				await saveRuntimeConfig(tempProject, {
					selectedAgentId: "claude",
					selectedShortcutId: null,
					readyForReviewNotificationsEnabled: true,
					shortcuts: [],
					commitLocalPromptTemplate: current.commitLocalPromptTemplateDefault,
					commitWorktreePromptTemplate: current.commitWorktreePromptTemplateDefault,
					openPrLocalPromptTemplate: current.openPrLocalPromptTemplateDefault,
					openPrWorktreePromptTemplate: current.openPrWorktreePromptTemplateDefault,
				});

				const globalPayload = JSON.parse(readFileSync(join(tempHome, ".kanbanana", "config.json"), "utf8")) as {
					selectedAgentId?: string;
					readyForReviewNotificationsEnabled?: boolean;
					commitLocalPromptTemplate?: string;
					commitWorktreePromptTemplate?: string;
					openPrLocalPromptTemplate?: string;
					openPrWorktreePromptTemplate?: string;
				};
				expect(globalPayload.selectedAgentId).toBeUndefined();
				expect(globalPayload.readyForReviewNotificationsEnabled).toBeUndefined();
				expect(globalPayload.commitLocalPromptTemplate).toBeUndefined();
				expect(globalPayload.commitWorktreePromptTemplate).toBeUndefined();
				expect(globalPayload.openPrLocalPromptTemplate).toBeUndefined();
				expect(globalPayload.openPrWorktreePromptTemplate).toBeUndefined();

				const projectPayload = JSON.parse(readFileSync(join(tempProject, ".kanbanana", "config.json"), "utf8")) as {
					shortcuts?: unknown[];
				};
				expect(projectPayload.shortcuts).toBeUndefined();
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("updateRuntimeConfig supports partial updates", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanbanana-home-runtime-config-partial-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanbanana-project-runtime-config-partial-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const before = await loadRuntimeConfig(tempProject);
				expect(before.selectedAgentId).toBe("claude");

				const updated = await updateRuntimeConfig(tempProject, {
					selectedAgentId: "cline",
				});
				expect(updated.selectedAgentId).toBe("cline");

				const globalPayload = JSON.parse(readFileSync(join(tempHome, ".kanbanana", "config.json"), "utf8")) as {
					selectedAgentId?: string;
					selectedShortcutId?: string;
					readyForReviewNotificationsEnabled?: boolean;
				};
				expect(globalPayload.selectedAgentId).toBe("cline");
				expect(globalPayload.selectedShortcutId).toBeUndefined();
				expect(globalPayload.readyForReviewNotificationsEnabled).toBeUndefined();
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});
});
