import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeConfigState } from "../config/runtime-config";
import { createWorkspaceRegistry } from "./workspace-registry";

const listWorkspaceIndexEntriesMock = vi.hoisted(() => vi.fn());
const loadWorkspaceContextMock = vi.hoisted(() => vi.fn());
const loadWorkspaceStateMock = vi.hoisted(() => vi.fn());
const removeWorkspaceIndexEntryMock = vi.hoisted(() => vi.fn());
const removeWorkspaceStateFilesMock = vi.hoisted(() => vi.fn());

vi.mock("../state/workspace-state", () => ({
	listWorkspaceIndexEntries: listWorkspaceIndexEntriesMock,
	loadWorkspaceContext: loadWorkspaceContextMock,
	loadWorkspaceState: loadWorkspaceStateMock,
	removeWorkspaceIndexEntry: removeWorkspaceIndexEntryMock,
	removeWorkspaceStateFiles: removeWorkspaceStateFilesMock,
}));

vi.mock("../terminal/session-manager", () => ({
	TerminalSessionManager: class TerminalSessionManager {
		/**
		 * Mirrors the session-manager API that workspace-registry uses during tests.
		 */
		hydrateFromRecord(): void {}

		/**
		 * Mirrors the session-manager API that workspace-registry uses during tests.
		 */
		listSummaries(): [] {
			return [];
		}

		/**
		 * Mirrors the session-manager API that workspace-registry uses during tests.
		 */
		markInterruptedAndStopAll(): [] {
			return [];
		}
	},
}));

/**
 * Returns a minimal runtime-config fixture for workspace-registry tests.
 */
function createRuntimeConfig() {
	return {
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: null,
		selectedAgentId: "codex",
		selectedShortcutLabel: null,
		agentAutonomousModeEnabled: false,
		readyForReviewNotificationsEnabled: true,
		shortcuts: [],
		commitPromptTemplate: "Commit prompt",
		openPrPromptTemplate: "PR prompt",
		commitPromptTemplateDefault: "Commit prompt",
		openPrPromptTemplateDefault: "PR prompt",
	} satisfies RuntimeConfigState;
}

describe("createWorkspaceRegistry", () => {
	beforeEach(() => {
		listWorkspaceIndexEntriesMock.mockReset();
		listWorkspaceIndexEntriesMock.mockResolvedValue([]);
		loadWorkspaceContextMock.mockReset();
		loadWorkspaceContextMock.mockResolvedValue(null);
		loadWorkspaceStateMock.mockReset();
		loadWorkspaceStateMock.mockRejectedValue(new Error("not needed"));
		removeWorkspaceIndexEntryMock.mockReset();
		removeWorkspaceStateFilesMock.mockReset();
	});

	it("notifies when a workspace is remembered after startup", async () => {
		const onWorkspaceRemembered = vi.fn();
		const registry = await createWorkspaceRegistry({
			cwd: "/repo",
			loadGlobalRuntimeConfig: async () => createRuntimeConfig(),
			loadRuntimeConfig: async () => createRuntimeConfig(),
			hasGitRepository: () => false,
			pathIsDirectory: async () => true,
			onWorkspaceRemembered,
		});

		registry.rememberWorkspace("workspace-2", "/repo/two");

		expect(onWorkspaceRemembered).toHaveBeenCalledWith("workspace-2", "/repo/two");
		expect(registry.getWorkspacePathById("workspace-2")).toBe("/repo/two");
	});
});
