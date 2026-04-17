import type { Dispatch, SetStateAction } from "react";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDetailTaskNavigation } from "@/hooks/use-detail-task-navigation";
import type { BoardData } from "@/types";

function createBoard(): BoardData {
	return {
		columns: [
			{
				id: "backlog",
				title: "Backlog",
				cards: [
					{
						id: "task-1",
						title: "Task 1",
						prompt: "Task 1",
						startInPlanMode: false,
						autoReviewEnabled: false,
						autoReviewMode: "commit",
						baseRef: "main",
						createdAt: 1,
						updatedAt: 1,
					},
				],
			},
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

interface HookSnapshot {
	selectedTaskId: string | null;
	setSelectedTaskId: Dispatch<SetStateAction<string | null>>;
}

function HookHarness({
	board,
	currentProjectId,
	onDetailClosed,
	onSnapshot,
}: {
	board: BoardData;
	currentProjectId: string | null;
	onDetailClosed?: () => void;
	onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
	const navigation = useDetailTaskNavigation({
		board,
		currentProjectId,
		isAwaitingWorkspaceSnapshot: false,
		isInitialRuntimeLoad: false,
		isProjectSwitching: false,
		isWorkspaceMetadataPending: false,
		onDetailClosed,
	});

	useEffect(() => {
		onSnapshot({
			selectedTaskId: navigation.selectedTaskId,
			setSelectedTaskId: navigation.setSelectedTaskId,
		});
	}, [navigation.selectedTaskId, navigation.setSelectedTaskId, onSnapshot]);

	return null;
}

function requireSnapshot(snapshot: HookSnapshot | null): HookSnapshot {
	if (!snapshot) {
		throw new Error("Expected hook snapshot to be available.");
	}
	return snapshot;
}

describe("useDetailTaskNavigation", () => {
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
		window.history.replaceState({}, "", "/project-1");
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		window.history.replaceState({}, "", "/");
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("keeps the selected task open across same-project rerenders", () => {
		const board = createBoard();
		let latestSnapshot: HookSnapshot | null = null;

		const renderHarness = (onDetailClosed?: () => void) => {
			act(() => {
				root.render(
					<HookHarness
						board={board}
						currentProjectId="project-1"
						onDetailClosed={onDetailClosed}
						onSnapshot={(snapshot) => {
							latestSnapshot = snapshot;
						}}
					/>,
				);
			});
		};

		renderHarness(() => {});

		act(() => {
			requireSnapshot(latestSnapshot).setSelectedTaskId("task-1");
		});

		expect(requireSnapshot(latestSnapshot).selectedTaskId).toBe("task-1");

		renderHarness(() => {});

		expect(requireSnapshot(latestSnapshot).selectedTaskId).toBe("task-1");
	});

	it("closes the selected task when the project changes", () => {
		const board = createBoard();
		let latestSnapshot: HookSnapshot | null = null;
		const onDetailClosed = vi.fn();

		act(() => {
			root.render(
				<HookHarness
					board={board}
					currentProjectId="project-1"
					onDetailClosed={onDetailClosed}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		act(() => {
			requireSnapshot(latestSnapshot).setSelectedTaskId("task-1");
		});

		act(() => {
			root.render(
				<HookHarness
					board={board}
					currentProjectId="project-2"
					onDetailClosed={onDetailClosed}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		expect(requireSnapshot(latestSnapshot).selectedTaskId).toBeNull();
		expect(onDetailClosed).toHaveBeenCalled();
	});
});
