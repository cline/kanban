import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useColumnCollapseState } from "@/hooks/use-column-collapse-state";
import { LocalStorageKey } from "@/storage/local-storage-store";

vi.mock("@/storage/local-storage-store", () => ({
	LocalStorageKey: {
		TaskDetailColumnsCollapsed: "kanban.task-detail-columns-collapsed",
	},
	readLocalStorageItem: vi.fn(),
	writeLocalStorageItem: vi.fn(),
}));

import { readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";

const mockReadLocalStorageItem = vi.mocked(readLocalStorageItem);
const mockWriteLocalStorageItem = vi.mocked(writeLocalStorageItem);

type ColumnCollapseStateResult = ReturnType<typeof useColumnCollapseState>;

function HookHarness({
	projectId,
	onResult,
}: {
	projectId: string | null | undefined;
	onResult: (result: ColumnCollapseStateResult) => void;
}): null {
	const result = useColumnCollapseState(projectId);
	onResult(result);
	return null;
}

function getResult(result: ColumnCollapseStateResult | null): ColumnCollapseStateResult {
	if (result === null) {
		throw new Error("Expected hook result.");
	}
	return result;
}

describe("useColumnCollapseState", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		mockReadLocalStorageItem.mockReset();
		mockWriteLocalStorageItem.mockReset();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		vi.restoreAllMocks();
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	describe("default state", () => {
		it("returns default collapse state when no projectId provided", async () => {
			let hookResult: ColumnCollapseStateResult | null = null;

			await act(async () => {
				root.render(
					<HookHarness
						projectId={null}
						onResult={(result) => {
							hookResult = result;
						}}
					/>,
				);
			});

			const result = getResult(hookResult);
			expect(result.collapseState).toEqual({
				backlog: true,
				in_progress: true,
				review: true,
				trash: false,
			});
			expect(mockReadLocalStorageItem).not.toHaveBeenCalled();
		});

		it("returns default collapse state when projectId is undefined", async () => {
			let hookResult: ColumnCollapseStateResult | null = null;

			await act(async () => {
				root.render(
					<HookHarness
						projectId={undefined}
						onResult={(result) => {
							hookResult = result;
						}}
					/>,
				);
			});

			const result = getResult(hookResult);
			expect(result.collapseState).toEqual({
				backlog: true,
				in_progress: true,
				review: true,
				trash: false,
			});
		});
	});

	describe("loading persisted state", () => {
		it("loads persisted state for a project", async () => {
			mockReadLocalStorageItem.mockReturnValue(
				JSON.stringify({
					"project-a": { backlog: false, in_progress: true, review: false, trash: true },
				}),
			);

			let hookResult: ColumnCollapseStateResult | null = null;

			await act(async () => {
				root.render(
					<HookHarness
						projectId="project-a"
						onResult={(result) => {
							hookResult = result;
						}}
					/>,
				);
			});

			expect(mockReadLocalStorageItem).toHaveBeenCalledWith(LocalStorageKey.TaskDetailColumnsCollapsed);
			const result = getResult(hookResult);
			expect(result.collapseState).toEqual({
				backlog: false,
				in_progress: true,
				review: false,
				trash: true,
			});
		});

		it("returns default state when localStorage is empty", async () => {
			mockReadLocalStorageItem.mockReturnValue(null);

			let hookResult: ColumnCollapseStateResult | null = null;

			await act(async () => {
				root.render(
					<HookHarness
						projectId="project-b"
						onResult={(result) => {
							hookResult = result;
						}}
					/>,
				);
			});

			const result = getResult(hookResult);
			expect(result.collapseState).toEqual({
				backlog: true,
				in_progress: true,
				review: true,
				trash: false,
			});
		});

		it("returns default state when project not in storage", async () => {
			mockReadLocalStorageItem.mockReturnValue(JSON.stringify({ "project-a": { backlog: false } }));

			let hookResult: ColumnCollapseStateResult | null = null;

			await act(async () => {
				root.render(
					<HookHarness
						projectId="project-b"
						onResult={(result) => {
							hookResult = result;
						}}
					/>,
				);
			});

			const result = getResult(hookResult);
			expect(result.collapseState).toEqual({
				backlog: true,
				in_progress: true,
				review: true,
				trash: false,
			});
		});

		it("returns default state on JSON parse error", async () => {
			mockReadLocalStorageItem.mockReturnValue("invalid-json");

			let hookResult: ColumnCollapseStateResult | null = null;

			await act(async () => {
				root.render(
					<HookHarness
						projectId="project-c"
						onResult={(result) => {
							hookResult = result;
						}}
					/>,
				);
			});

			const result = getResult(hookResult);
			expect(result.collapseState).toEqual({
				backlog: true,
				in_progress: true,
				review: true,
				trash: false,
			});
		});

		it("merges stored values with defaults for missing columns", async () => {
			mockReadLocalStorageItem.mockReturnValue(
				JSON.stringify({
					"project-a": { backlog: false, trash: true },
				}),
			);

			let hookResult: ColumnCollapseStateResult | null = null;

			await act(async () => {
				root.render(
					<HookHarness
						projectId="project-a"
						onResult={(result) => {
							hookResult = result;
						}}
					/>,
				);
			});

			const result = getResult(hookResult);
			expect(result.collapseState).toEqual({
				backlog: false,
				in_progress: true,
				review: true,
				trash: true,
			});
		});
	});

	describe("toggleColumn", () => {
		it("toggles column state and persists", async () => {
			mockReadLocalStorageItem.mockReturnValue(null);

			let hookResult: ColumnCollapseStateResult | null = null;

			await act(async () => {
				root.render(
					<HookHarness
						projectId="project-a"
						onResult={(result) => {
							hookResult = result;
						}}
					/>,
				);
			});

			expect(getResult(hookResult).collapseState.backlog).toBe(true);

			await act(async () => {
				getResult(hookResult).toggleColumn("backlog");
			});

			expect(getResult(hookResult).collapseState.backlog).toBe(false);
			expect(mockWriteLocalStorageItem).toHaveBeenCalledWith(
				LocalStorageKey.TaskDetailColumnsCollapsed,
				JSON.stringify({ "project-a": { backlog: false, in_progress: true, review: true, trash: false } }),
			);
		});

		it("does nothing when projectId is null", async () => {
			let hookResult: ColumnCollapseStateResult | null = null;

			await act(async () => {
				root.render(
					<HookHarness
						projectId={null}
						onResult={(result) => {
							hookResult = result;
						}}
					/>,
				);
			});

			await act(async () => {
				getResult(hookResult).toggleColumn("backlog");
			});

			expect(mockWriteLocalStorageItem).not.toHaveBeenCalled();
			expect(getResult(hookResult).collapseState.backlog).toBe(true);
		});

		it("preserves state for other projects", async () => {
			mockReadLocalStorageItem.mockReturnValue(
				JSON.stringify({
					"project-a": { backlog: false },
					"project-b": { review: false },
				}),
			);

			let hookResult: ColumnCollapseStateResult | null = null;

			await act(async () => {
				root.render(
					<HookHarness
						projectId="project-a"
						onResult={(result) => {
							hookResult = result;
						}}
					/>,
				);
			});

			await act(async () => {
				getResult(hookResult).toggleColumn("in_progress");
			});

			expect(mockWriteLocalStorageItem).toHaveBeenCalledWith(
				LocalStorageKey.TaskDetailColumnsCollapsed,
				JSON.stringify({
					"project-a": { backlog: false, in_progress: false, review: true, trash: false },
					"project-b": { review: false },
				}),
			);
		});
	});

	describe("setColumnOpen", () => {
		it("sets column open state and persists when changed", async () => {
			mockReadLocalStorageItem.mockReturnValue(null);

			let hookResult: ColumnCollapseStateResult | null = null;

			await act(async () => {
				root.render(
					<HookHarness
						projectId="project-a"
						onResult={(result) => {
							hookResult = result;
						}}
					/>,
				);
			});

			expect(getResult(hookResult).collapseState.trash).toBe(false);

			await act(async () => {
				getResult(hookResult).setColumnOpen("trash", true);
			});

			expect(getResult(hookResult).collapseState.trash).toBe(true);
			expect(mockWriteLocalStorageItem).toHaveBeenCalled();
		});

		it("does not persist when value unchanged", async () => {
			mockReadLocalStorageItem.mockReturnValue(null);

			let hookResult: ColumnCollapseStateResult | null = null;

			await act(async () => {
				root.render(
					<HookHarness
						projectId="project-a"
						onResult={(result) => {
							hookResult = result;
						}}
					/>,
				);
			});

			expect(getResult(hookResult).collapseState.backlog).toBe(true);

			await act(async () => {
				getResult(hookResult).setColumnOpen("backlog", true);
			});

			expect(mockWriteLocalStorageItem).not.toHaveBeenCalled();
		});

		it("does nothing when projectId is null", async () => {
			let hookResult: ColumnCollapseStateResult | null = null;

			await act(async () => {
				root.render(
					<HookHarness
						projectId={null}
						onResult={(result) => {
							hookResult = result;
						}}
					/>,
				);
			});

			await act(async () => {
				getResult(hookResult).setColumnOpen("trash", true);
			});

			expect(mockWriteLocalStorageItem).not.toHaveBeenCalled();
			expect(getResult(hookResult).collapseState.trash).toBe(false);
		});
	});
});
