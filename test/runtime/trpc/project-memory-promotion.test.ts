import { beforeEach, describe, expect, it, vi } from "vitest";

const memoryMocks = vi.hoisted(() => ({
	readProjectMemory: vi.fn(),
	updateProjectMemory: vi.fn(),
}));

const workspaceStateMocks = vi.hoisted(() => ({
	loadWorkspaceState: vi.fn(),
}));

vi.mock("../../../src/state/project-memory.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../../src/state/project-memory.js")>()),
	readProjectMemory: memoryMocks.readProjectMemory,
	updateProjectMemory: memoryMocks.updateProjectMemory,
}));

vi.mock("../../../src/state/workspace-state.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../../src/state/workspace-state.js")>()),
	loadWorkspaceState: workspaceStateMocks.loadWorkspaceState,
}));

import { createWorkspaceApi } from "../../../src/trpc/workspace-api";

describe("project memory promotion", () => {
	beforeEach(() => {
		memoryMocks.readProjectMemory.mockReset();
		memoryMocks.updateProjectMemory.mockReset();
		workspaceStateMocks.loadWorkspaceState.mockReset();
	});

	it("replaces project memory with the model-consolidated document instead of appending raw summaries", async () => {
		const existingMemory = "# Commands\n\n- Use npm test.";
		const consolidatedMemory = "# Commands\n\n- Use npm test -- --run.";
		workspaceStateMocks.loadWorkspaceState.mockResolvedValue({
			board: {
				columns: [
					{
						id: "review",
						title: "Review",
						cards: [
							{
								id: "task-1",
								title: "Fix focused tests",
								summary: { content: "Use npm test -- --run.", source: "automatic", updatedAt: 1 },
							},
						],
					},
				],
			},
		});
		memoryMocks.readProjectMemory.mockResolvedValue({ type: "success", content: existingMemory });
		let writtenMemory = "";
		memoryMocks.updateProjectMemory.mockImplementation(
			async (_workspaceId: string, update: (value: string) => string) => {
				writtenMemory = update(existingMemory);
				return { type: "success", content: writtenMemory };
			},
		);
		const consolidate = vi.fn(async () => consolidatedMemory);
		const api = createWorkspaceApi({
			ensureTerminalManagerForWorkspace: vi.fn(),
			getScopedClineTaskSessionService: vi.fn(),
			consolidateProjectMemory: consolidate,
			broadcastRuntimeWorkspaceStateUpdated: vi.fn(),
			broadcastRuntimeProjectsUpdated: vi.fn(),
			buildWorkspaceStateSnapshot: vi.fn(),
		});

		await api.promoteCardSummaryToProjectMemory(
			{ workspaceId: "workspace-1", workspacePath: "C:\\repo" },
			{ taskId: "task-1" },
		);

		expect(consolidate).toHaveBeenCalledWith({
			workspacePath: "C:\\repo",
			currentMemory: existingMemory,
			taskId: "task-1",
			taskTitle: "Fix focused tests",
			taskSummary: "Use npm test -- --run.",
		});
		expect(writtenMemory).toBe(consolidatedMemory);
	});
});
