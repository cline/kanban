import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";

vi.mock("@/terminal/use-persistent-terminal-session", () => ({
	usePersistentTerminalSession: () => ({
		clearTerminal: () => {},
		containerRef: { current: null },
		isStopping: false,
		lastError: null,
		stopTerminal: async () => {},
	}),
}));

function createSummary(state: RuntimeTaskSessionSummary["state"]): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state,
		agentId: "claude",
		workspacePath: "/tmp/worktree",
		pid: null,
		startedAt: 1,
		updatedAt: 1,
		lastOutputAt: 1,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}

describe("AgentTerminalPanel", () => {
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

	it("shows an explicit resume action for interrupted sessions", async () => {
		const onResume = vi.fn();

		await act(async () => {
			root.render(
				<AgentTerminalPanel
					taskId="task-1"
					workspaceId="project-1"
					summary={createSummary("interrupted")}
					onResume={onResume}
				/>,
			);
		});

		expect(container.textContent).toContain("Interrupted");

		const resumeButton = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Resume"),
		);
		expect(resumeButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			(resumeButton as HTMLButtonElement).click();
		});

		expect(onResume).toHaveBeenCalledTimes(1);
	});
});
