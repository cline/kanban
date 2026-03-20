import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CardDetailView } from "@/components/card-detail-view";
import { TERMINAL_THEME_COLORS } from "@/terminal/theme-colors";
import type { BoardCard, BoardColumn, CardSelection } from "@/types";

const mockUseRuntimeWorkspaceChanges = vi.fn();
const { mockAgentTerminalPanel } = vi.hoisted(() => ({
	mockAgentTerminalPanel: vi.fn((_props: { panelBackgroundColor?: string; terminalBackgroundColor?: string }) => null),
}));

vi.mock("react-hotkeys-hook", () => ({
	useHotkeys: () => {},
}));

vi.mock("@/components/detail-panels/agent-terminal-panel", () => ({
	AgentTerminalPanel: mockAgentTerminalPanel,
}));

vi.mock("@/components/detail-panels/cline-agent-chat-panel", () => ({
	ClineAgentChatPanel: () => <div data-testid="cline-agent-chat-panel" />,
}));

vi.mock("@/components/detail-panels/column-context-panel", () => ({
	ColumnContextPanel: () => <div data-testid="column-context-panel" />,
}));

vi.mock("@/components/detail-panels/diff-viewer-panel", () => ({
	DiffViewerPanel: () => <div data-testid="diff-viewer-panel" />,
}));

vi.mock("@/components/detail-panels/file-tree-panel", () => ({
	FileTreePanel: () => <div data-testid="file-tree-panel" />,
}));

vi.mock("@/components/resizable-bottom-pane", () => ({
	ResizableBottomPane: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/runtime/use-runtime-workspace-changes", () => ({
	useRuntimeWorkspaceChanges: (...args: unknown[]) => mockUseRuntimeWorkspaceChanges(...args),
}));

vi.mock("@/stores/workspace-metadata-store", () => ({
	useTaskWorkspaceStateVersionValue: () => 0,
}));

function createCard(id: string): BoardCard {
	return {
		id,
		title: `Task ${id}`,
		prompt: `Task ${id}`,
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit",
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
	};
}

function createSelection(): CardSelection {
	const card = createCard("task-1");
	const columns: BoardColumn[] = [
		{
			id: "backlog",
			title: "Backlog",
			cards: [card],
		},
		{
			id: "in_progress",
			title: "In Progress",
			cards: [],
		},
		{
			id: "review",
			title: "Review",
			cards: [],
		},
		{
			id: "trash",
			title: "Trash",
			cards: [],
		},
	];
	return {
		card,
		column: columns[0]!,
		allColumns: columns,
	};
}

describe("CardDetailView", () => {
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
		mockAgentTerminalPanel.mockClear();
		mockUseRuntimeWorkspaceChanges.mockReturnValue({
			changes: {
				files: [
					{
						path: "src/example.ts",
						status: "modified",
						additions: 1,
						deletions: 0,
						oldText: "before\n",
						newText: "after\n",
					},
				],
			},
			isRuntimeAvailable: true,
		});
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		mockUseRuntimeWorkspaceChanges.mockReset();
		mockAgentTerminalPanel.mockClear();
		vi.restoreAllMocks();
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("collapses the expanded diff on Escape without closing the detail view", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const expandButton = container.querySelector('button[aria-label="Expand split diff view"]');
		expect(expandButton).toBeInstanceOf(HTMLButtonElement);
		if (!(expandButton instanceof HTMLButtonElement)) {
			throw new Error("Expected an expand diff button.");
		}

		await act(async () => {
			expandButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			expandButton.click();
		});

		const toolbarButtons = Array.from(container.querySelectorAll("button"));
		expect(toolbarButtons[0]?.getAttribute("aria-label")).toBe("Collapse expanded diff view");
		expect(toolbarButtons[1]?.textContent?.trim()).toBe("All Changes");
		expect(toolbarButtons[2]?.textContent?.trim()).toBe("Last Turn");
		expect(container.querySelector('button[aria-label="Expand split diff view"]')).toBeNull();

		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		});

		expect(container.querySelector('button[aria-label="Collapse expanded diff view"]')).toBeNull();
		expect(container.querySelector('button[aria-label="Expand split diff view"]')).toBeInstanceOf(HTMLButtonElement);
	});

	it("clears stale diff content when switching from all changes to last turn", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const lastTurnButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Last Turn",
		);
		expect(lastTurnButton).toBeInstanceOf(HTMLButtonElement);
		if (!(lastTurnButton instanceof HTMLButtonElement)) {
			throw new Error("Expected a Last Turn button.");
		}

		await act(async () => {
			lastTurnButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			lastTurnButton.click();
		});

		const lastCall = mockUseRuntimeWorkspaceChanges.mock.calls.at(-1);
		expect(lastCall?.[3]).toBe("last_turn");
		expect(lastCall?.[7]).toBe(true);
	});

	it("closes git history before handling other Escape behavior", async () => {
		const onCloseGitHistory = vi.fn();

		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					gitHistoryPanel={<div data-testid="git-history-panel">Git history</div>}
					onCloseGitHistory={onCloseGitHistory}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const input = document.createElement("input");
		container.appendChild(input);
		input.focus();

		await act(async () => {
			input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		});

		expect(onCloseGitHistory).toHaveBeenCalledTimes(1);
	});

	it("renders native chat panel for cline agent", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					selectedAgentId="cline"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		expect(container.querySelector('[data-testid="cline-agent-chat-panel"]')).toBeInstanceOf(HTMLDivElement);
		expect(container.querySelector('[data-testid="agent-terminal-panel"]')).toBeNull();
	});

	it("uses surface-primary colors for the detail terminal panel", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					selectedAgentId="claude"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const lastCall = mockAgentTerminalPanel.mock.calls.at(-1);
		expect(lastCall?.[0]).toMatchObject({
			panelBackgroundColor: TERMINAL_THEME_COLORS.surfacePrimary,
			terminalBackgroundColor: TERMINAL_THEME_COLORS.surfacePrimary,
		});
	});
});
