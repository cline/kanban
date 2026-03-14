import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
		input: vi.fn(() => true),
		paste: vi.fn(() => true),
		clear: vi.fn(),
		stop: vi.fn(async () => {}),
	};
}

function HookHarness({
	taskId,
	workspaceId,
	sessionStartedAt,
	enabled = true,
}: {
	taskId: string;
	workspaceId: string | null;
	sessionStartedAt: number | null;
	enabled?: boolean;
}) {
	const { containerRef } = usePersistentTerminalSession({
		taskId,
		workspaceId,
		enabled,
		sessionStartedAt,
		terminalBackgroundColor: "terminal-background",
		cursorColor: "cursor-color",
	});

	return <div ref={containerRef} />;
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

	it("recreates the persistent terminal when a new session starts for the same task", async () => {
		await act(async () => {
			root.render(<HookHarness taskId="task-a" workspaceId="project-1" sessionStartedAt={100} />);
		});

		expect(disposePersistentTerminalMock).not.toHaveBeenCalled();
		expect(ensurePersistentTerminalMock).toHaveBeenCalledTimes(1);

		await act(async () => {
			root.render(<HookHarness taskId="task-a" workspaceId="project-1" sessionStartedAt={200} />);
		});

		expect(disposePersistentTerminalMock).toHaveBeenCalledTimes(1);
		expect(disposePersistentTerminalMock).toHaveBeenCalledWith("project-1", "task-a");
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
});
