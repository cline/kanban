import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useProjectUiState } from "@/hooks/use-project-ui-state";
import type { BoardData } from "@/types";

type ProjectUiStateResult = ReturnType<typeof useProjectUiState>;

function createBoard(): BoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
	};
}

function HookHarness({ onResult }: { onResult: (result: ReturnType<typeof useProjectUiState>) => void }): null {
	const result = useProjectUiState({
		board: createBoard(),
		canPersistWorkspaceState: true,
		currentProjectId: "project-b",
		projects: [
			{
				id: "project-a",
				name: "project-a",
				path: "/tmp/project-a",
				taskCounts: { backlog: 1, in_progress: 0, review: 1, trash: 0 },
			},
			{
				id: "project-b",
				name: "project-b",
				path: "/tmp/project-b",
				taskCounts: { backlog: 0, in_progress: 0, review: 0, trash: 0 },
			},
		],
		navigationCurrentProjectId: "project-b",
		selectedTaskId: null,
		streamError: null,
		isProjectSwitching: false,
		isInitialRuntimeLoad: false,
		isAwaitingWorkspaceSnapshot: false,
		isWorkspaceMetadataPending: true,
		hasReceivedSnapshot: true,
	});

	onResult(result);
	return null;
}

describe("useProjectUiState", () => {
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
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("keeps the project loading state visible while workspace metadata is still syncing", async () => {
		let latestResult: ProjectUiStateResult | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					onResult={(result) => {
						latestResult = result;
					}}
				/>,
			);
		});

		if (latestResult === null) {
			throw new Error("Expected a hook result.");
		}
		const result: ProjectUiStateResult = latestResult;
		expect(result.shouldShowProjectLoadingState).toBe(true);
		expect(result.shouldUseNavigationPath).toBe(true);
	});
});
