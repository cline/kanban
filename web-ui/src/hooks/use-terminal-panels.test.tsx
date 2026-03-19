import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTerminalPanels } from "@/hooks/use-terminal-panels";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
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
	detailTerminalTaskId: string | null;
	handleToggleDetailTerminal: ReturnType<typeof useTerminalPanels>["handleToggleDetailTerminal"];
	isDetailTerminalOpen: boolean;
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
			detailTerminalTaskId: result.detailTerminalTaskId,
			handleToggleDetailTerminal: result.handleToggleDetailTerminal,
			isDetailTerminalOpen: result.isDetailTerminalOpen,
		});
	}, [onSnapshot, result.detailTerminalTaskId, result.handleToggleDetailTerminal, result.isDetailTerminalOpen]);

	return null;
}

describe("useTerminalPanels", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
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
});
