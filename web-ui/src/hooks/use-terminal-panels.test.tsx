import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTerminalPanels } from "@/hooks/use-terminal-panels";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { LocalStorageKey } from "@/storage/local-storage-store";
import type { CardSelection } from "@/types";

const startShellSessionMutateMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		runtime: {
			startShellSession: {
				mutate: startShellSessionMutateMock,
			},
		},
	}),
}));

vi.mock("@/terminal/terminal-geometry-registry", () => ({
	getTerminalGeometry: () => ({ cols: 120, rows: 24 }),
	prepareWaitForTerminalGeometry: () => () => Promise.resolve(),
}));

interface HookSnapshot {
	collapseDetailTerminal: ReturnType<typeof useTerminalPanels>["collapseDetailTerminal"];
	collapseHomeTerminal: ReturnType<typeof useTerminalPanels>["collapseHomeTerminal"];
	detailTerminalPaneHeight: number | undefined;
	detailTerminalTaskId: string | null;
	handleToggleDetailTerminal: ReturnType<typeof useTerminalPanels>["handleToggleDetailTerminal"];
	homeTerminalPaneHeight: number | undefined;
	isDetailTerminalOpen: boolean;
	resetBottomTerminalLayoutCustomizations: ReturnType<
		typeof useTerminalPanels
	>["resetBottomTerminalLayoutCustomizations"];
	setDetailTerminalPaneHeight: ReturnType<typeof useTerminalPanels>["setDetailTerminalPaneHeight"];
	setHomeTerminalPaneHeight: ReturnType<typeof useTerminalPanels>["setHomeTerminalPaneHeight"];
}

function createSelection(taskId: string): CardSelection {
	const card = {
		id: taskId,
		prompt: `Task ${taskId}`,
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit" as const,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
	};
	const column = {
		id: "in_progress" as const,
		title: "In Progress",
		cards: [card],
	};
	return {
		card,
		column,
		allColumns: [column],
	};
}

function createSummary(taskId: string): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "running",
		agentId: "codex",
		workspacePath: `/tmp/${taskId}`,
		pid: 123,
		startedAt: 1,
		updatedAt: 1,
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
	};
}

async function flushPromises(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

function requireSnapshot(snapshot: HookSnapshot | null): HookSnapshot {
	if (snapshot === null) {
		throw new Error("Expected a hook snapshot.");
	}
	return snapshot;
}

function HookHarness({
	onSnapshot,
	selectedCard,
}: {
	onSnapshot: (snapshot: HookSnapshot) => void;
	selectedCard: CardSelection | null;
}): null {
	const result = useTerminalPanels({
		currentProjectId: "project-1",
		selectedCard,
		workspaceGit: null,
		agentCommand: null,
		upsertSession: () => {},
		sendTaskSessionInput: async () => ({ ok: true }),
	});

	useEffect(() => {
		onSnapshot({
			collapseDetailTerminal: result.collapseDetailTerminal,
			collapseHomeTerminal: result.collapseHomeTerminal,
			detailTerminalPaneHeight: result.detailTerminalPaneHeight,
			detailTerminalTaskId: result.detailTerminalTaskId,
			handleToggleDetailTerminal: result.handleToggleDetailTerminal,
			homeTerminalPaneHeight: result.homeTerminalPaneHeight,
			isDetailTerminalOpen: result.isDetailTerminalOpen,
			resetBottomTerminalLayoutCustomizations: result.resetBottomTerminalLayoutCustomizations,
			setDetailTerminalPaneHeight: result.setDetailTerminalPaneHeight,
			setHomeTerminalPaneHeight: result.setHomeTerminalPaneHeight,
		});
	}, [
		onSnapshot,
		result.collapseDetailTerminal,
		result.collapseHomeTerminal,
		result.detailTerminalPaneHeight,
		result.detailTerminalTaskId,
		result.handleToggleDetailTerminal,
		result.homeTerminalPaneHeight,
		result.isDetailTerminalOpen,
		result.resetBottomTerminalLayoutCustomizations,
		result.setDetailTerminalPaneHeight,
		result.setHomeTerminalPaneHeight,
	]);

	return null;
}

describe("useTerminalPanels", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		window.localStorage.clear();
		startShellSessionMutateMock.mockReset();
		startShellSessionMutateMock.mockImplementation(async ({ taskId }: { taskId: string }) => ({
			ok: true,
			summary: createSummary(taskId),
		}));
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

	it("tracks detail terminal visibility per task selection", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const selectionA = createSelection("task-a");
		const selectionB = createSelection("task-b");

		await act(async () => {
			root.render(
				<HookHarness
					selectedCard={selectionA}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushPromises();
		});

		const initialSnapshot = requireSnapshot(latestSnapshot);
		expect(initialSnapshot.isDetailTerminalOpen).toBe(false);
		expect(initialSnapshot.detailTerminalTaskId).toBe("__detail_terminal__:task-a");

		await act(async () => {
			requireSnapshot(latestSnapshot).handleToggleDetailTerminal();
			await flushPromises();
		});

		const openedTaskASnapshot = requireSnapshot(latestSnapshot);
		expect(openedTaskASnapshot.isDetailTerminalOpen).toBe(true);
		expect(startShellSessionMutateMock).toHaveBeenCalledTimes(1);
		expect(startShellSessionMutateMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				taskId: "__detail_terminal__:task-a",
				workspaceTaskId: "task-a",
			}),
		);

		await act(async () => {
			root.render(
				<HookHarness
					selectedCard={selectionB}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushPromises();
		});

		const taskBSnapshot = requireSnapshot(latestSnapshot);
		expect(taskBSnapshot.isDetailTerminalOpen).toBe(false);
		expect(taskBSnapshot.detailTerminalTaskId).toBe("__detail_terminal__:task-b");
		expect(startShellSessionMutateMock).toHaveBeenCalledTimes(1);

		await act(async () => {
			root.render(
				<HookHarness
					selectedCard={selectionA}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushPromises();
		});

		const restoredTaskASnapshot = requireSnapshot(latestSnapshot);
		expect(restoredTaskASnapshot.isDetailTerminalOpen).toBe(true);
		expect(restoredTaskASnapshot.detailTerminalTaskId).toBe("__detail_terminal__:task-a");
		expect(startShellSessionMutateMock).toHaveBeenCalledTimes(2);
		expect(startShellSessionMutateMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				taskId: "__detail_terminal__:task-a",
				workspaceTaskId: "task-a",
			}),
		);
	});

	it("shares the last resized bottom terminal height across home and detail panes", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const selectionA = createSelection("task-a");
		const selectionB = createSelection("task-b");

		const renderHarness = async (selectedCard: CardSelection | null): Promise<void> => {
			await act(async () => {
				root.render(
					<HookHarness
						selectedCard={selectedCard}
						onSnapshot={(snapshot) => {
							latestSnapshot = snapshot;
						}}
					/>,
				);
				await flushPromises();
			});
		};

		await renderHarness(selectionA);
		expect(requireSnapshot(latestSnapshot).homeTerminalPaneHeight).toBeUndefined();
		expect(requireSnapshot(latestSnapshot).detailTerminalPaneHeight).toBeUndefined();

		await act(async () => {
			requireSnapshot(latestSnapshot).setDetailTerminalPaneHeight(320);
			await flushPromises();
		});

		const detailResizedSnapshot = requireSnapshot(latestSnapshot);
		expect(detailResizedSnapshot.detailTerminalPaneHeight).toBe(320);
		expect(detailResizedSnapshot.homeTerminalPaneHeight).toBe(320);
		expect(window.localStorage.getItem(LocalStorageKey.BottomTerminalPaneHeight)).toBe("320");

		await renderHarness(selectionB);
		expect(requireSnapshot(latestSnapshot).detailTerminalPaneHeight).toBe(320);
		expect(requireSnapshot(latestSnapshot).homeTerminalPaneHeight).toBe(320);

		await act(async () => {
			requireSnapshot(latestSnapshot).setHomeTerminalPaneHeight(410);
			await flushPromises();
		});

		const homeResizedSnapshot = requireSnapshot(latestSnapshot);
		expect(homeResizedSnapshot.homeTerminalPaneHeight).toBe(410);
		expect(homeResizedSnapshot.detailTerminalPaneHeight).toBe(410);
		expect(window.localStorage.getItem(LocalStorageKey.BottomTerminalPaneHeight)).toBe("410");

		await act(async () => {
			root.unmount();
			root = createRoot(container);
			await flushPromises();
		});

		await renderHarness(selectionA);
		expect(requireSnapshot(latestSnapshot).homeTerminalPaneHeight).toBe(410);
		expect(requireSnapshot(latestSnapshot).detailTerminalPaneHeight).toBe(410);
	});

	it("resets the shared bottom terminal height when collapsed", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const selection = createSelection("task-a");

		await act(async () => {
			root.render(
				<HookHarness
					selectedCard={selection}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushPromises();
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).handleToggleDetailTerminal();
			await flushPromises();
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).setDetailTerminalPaneHeight(320);
			await flushPromises();
		});

		expect(requireSnapshot(latestSnapshot).detailTerminalPaneHeight).toBe(320);
		expect(window.localStorage.getItem(LocalStorageKey.BottomTerminalPaneHeight)).toBe("320");
		expect(requireSnapshot(latestSnapshot).isDetailTerminalOpen).toBe(true);

		await act(async () => {
			requireSnapshot(latestSnapshot).collapseDetailTerminal();
			await flushPromises();
		});

		expect(requireSnapshot(latestSnapshot).detailTerminalPaneHeight).toBeUndefined();
		expect(requireSnapshot(latestSnapshot).homeTerminalPaneHeight).toBeUndefined();
		expect(requireSnapshot(latestSnapshot).isDetailTerminalOpen).toBe(false);
		expect(window.localStorage.getItem(LocalStorageKey.BottomTerminalPaneHeight)).toBeNull();
	});

	it("resets the shared bottom terminal height without closing the current pane", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					selectedCard={null}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushPromises();
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).setHomeTerminalPaneHeight(420);
			await flushPromises();
		});

		expect(requireSnapshot(latestSnapshot).homeTerminalPaneHeight).toBe(420);
		expect(window.localStorage.getItem(LocalStorageKey.BottomTerminalPaneHeight)).toBe("420");

		await act(async () => {
			requireSnapshot(latestSnapshot).resetBottomTerminalLayoutCustomizations();
			await flushPromises();
		});

		expect(requireSnapshot(latestSnapshot).homeTerminalPaneHeight).toBeUndefined();
		expect(window.localStorage.getItem(LocalStorageKey.BottomTerminalPaneHeight)).toBeNull();
	});
});
