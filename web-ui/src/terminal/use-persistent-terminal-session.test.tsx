import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { usePersistentTerminalSession } from "@/terminal/use-persistent-terminal-session";

const ensurePersistentTerminalMock = vi.hoisted(() => vi.fn());
const disposePersistentTerminalMock = vi.hoisted(() => vi.fn());
const registerTerminalControllerMock = vi.hoisted(() => vi.fn());

vi.mock("@/terminal/persistent-terminal-manager", () => ({
	ensurePersistentTerminal: ensurePersistentTerminalMock,
	disposePersistentTerminal: disposePersistentTerminalMock,
}));

vi.mock("@/terminal/terminal-controller-registry", () => ({
	registerTerminalController: registerTerminalControllerMock,
}));

function createPersistentTerminalMock() {
	return {
		subscribe: vi.fn(() => vi.fn()),
		mount: vi.fn(),
		unmount: vi.fn(),
		reset: vi.fn(),
		reconnect: vi.fn(),
		input: vi.fn(() => true),
		paste: vi.fn(() => true),
		waitForLikelyPrompt: vi.fn(async () => true),
		clear: vi.fn(),
		stop: vi.fn(async () => {}),
	};
}

function HookHarness({
	taskId,
	workspaceId,
	sessionStartedAt,
	enabled = true,
	onSummary,
	onConnectionReady,
	onRender,
}: {
	taskId: string;
	workspaceId: string | null;
	sessionStartedAt: number | null;
	enabled?: boolean;
	onSummary?: (summary: RuntimeTaskSessionSummary) => void;
	onConnectionReady?: (taskId: string) => void;
	onRender?: (result: ReturnType<typeof usePersistentTerminalSession>) => void;
}) {
	const result = usePersistentTerminalSession({
		taskId,
		workspaceId,
		enabled,
		onSummary,
		onConnectionReady,
		sessionStartedAt,
		terminalBackgroundColor: "terminal-background",
		cursorColor: "cursor-color",
	});
	onRender?.(result);

	return <div ref={result.containerRef} />;
}

describe("usePersistentTerminalSession", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		ensurePersistentTerminalMock.mockReset();
		disposePersistentTerminalMock.mockReset();
		registerTerminalControllerMock.mockReset();
		registerTerminalControllerMock.mockReturnValue(() => {});
		ensurePersistentTerminalMock.mockImplementation(() => createPersistentTerminalMock());
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

	it("resets the persistent terminal in place when a new session starts for the same task", async () => {
		const terminal = createPersistentTerminalMock();
		ensurePersistentTerminalMock.mockReturnValue(terminal);

		await act(async () => {
			root.render(<HookHarness taskId="task-a" workspaceId="project-1" sessionStartedAt={100} />);
		});

		expect(disposePersistentTerminalMock).not.toHaveBeenCalled();
		expect(ensurePersistentTerminalMock).toHaveBeenCalledTimes(1);
		expect(terminal.reset).not.toHaveBeenCalled();

		await act(async () => {
			root.render(<HookHarness taskId="task-a" workspaceId="project-1" sessionStartedAt={200} />);
		});

		expect(disposePersistentTerminalMock).not.toHaveBeenCalled();
		expect(terminal.reset).toHaveBeenCalledTimes(1);
		expect(ensurePersistentTerminalMock).toHaveBeenCalledTimes(2);
	});

	it("does not dispose when the selected task changes", async () => {
		await act(async () => {
			root.render(<HookHarness taskId="task-a" workspaceId="project-1" sessionStartedAt={100} />);
		});

		await act(async () => {
			root.render(<HookHarness taskId="task-b" workspaceId="project-1" sessionStartedAt={200} />);
		});

		expect(disposePersistentTerminalMock).not.toHaveBeenCalled();
		expect(ensurePersistentTerminalMock).toHaveBeenCalledTimes(2);
	});

	it("disposes terminal when disabled", async () => {
		await act(async () => {
			root.render(<HookHarness taskId="task-a" workspaceId="project-1" sessionStartedAt={100} enabled />);
		});

		disposePersistentTerminalMock.mockClear();

		await act(async () => {
			root.render(<HookHarness taskId="task-a" workspaceId="project-1" sessionStartedAt={100} enabled={false} />);
		});

		expect(disposePersistentTerminalMock).toHaveBeenCalledTimes(1);
		expect(disposePersistentTerminalMock).toHaveBeenCalledWith("project-1", "task-a");
	});

	it("does not remount when callback props change", async () => {
		const terminal = createPersistentTerminalMock();
		ensurePersistentTerminalMock.mockReturnValue(terminal);

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-a"
					workspaceId="project-1"
					sessionStartedAt={100}
					onSummary={() => {}}
					onConnectionReady={() => {}}
				/>,
			);
		});

		expect(terminal.mount).toHaveBeenCalledTimes(1);
		expect(terminal.unmount).not.toHaveBeenCalled();

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-a"
					workspaceId="project-1"
					sessionStartedAt={100}
					onSummary={() => {}}
					onConnectionReady={() => {}}
				/>,
			);
		});

		expect(terminal.mount).toHaveBeenCalledTimes(1);
		expect(terminal.unmount).not.toHaveBeenCalled();
	});

	it("exposes reconnect controls for active workspace terminals", async () => {
		const terminal = createPersistentTerminalMock();
		ensurePersistentTerminalMock.mockReturnValue(terminal);
		const renderedResults: Array<ReturnType<typeof usePersistentTerminalSession>> = [];

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-a"
					workspaceId="project-1"
					sessionStartedAt={100}
					onRender={(result) => {
						renderedResults.push(result);
					}}
				/>,
			);
		});

		const latestResult = renderedResults.at(-1);
		expect(latestResult?.canReconnect).toBe(true);
		act(() => {
			latestResult?.reconnectTerminal();
		});
		expect(terminal.reconnect).toHaveBeenCalledTimes(1);
	});
});
