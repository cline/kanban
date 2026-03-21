import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHotkeys } from "react-hotkeys-hook";

import { useAppHotkeys } from "@/hooks/use-app-hotkeys";

vi.mock("react-hotkeys-hook", () => ({
	useHotkeys: vi.fn(),
}));

const mockUseHotkeys = vi.mocked(useHotkeys);

function HookHarness(props: Parameters<typeof useAppHotkeys>[0]): null {
	useAppHotkeys(props);
	return null;
}

describe("useAppHotkeys", () => {
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
		mockUseHotkeys.mockReset();
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

	it("registers git history and settings shortcuts", async () => {
		const handleToggleGitHistory = vi.fn();
		const handleOpenSettings = vi.fn();

		await act(async () => {
			root.render(
				<HookHarness
					selectedCard={null}
					isDetailTerminalOpen={false}
					isHomeTerminalOpen={false}
					isHomeGitHistoryOpen={false}
					handleToggleDetailTerminal={() => {}}
					handleToggleHomeTerminal={() => {}}
					handleToggleExpandDetailTerminal={() => {}}
					handleToggleExpandHomeTerminal={() => {}}
					handleOpenCreateTask={() => {}}
					handleOpenSettings={handleOpenSettings}
					handleToggleGitHistory={handleToggleGitHistory}
					handleCloseGitHistory={() => {}}
					onStartAllTasks={() => {}}
				/>,
			);
		});

		const gitHistoryCall = mockUseHotkeys.mock.calls.find(([shortcut]) => shortcut === "mod+g");
		if (!gitHistoryCall || typeof gitHistoryCall[1] !== "function") {
			throw new Error("Expected git history shortcut to be registered.");
		}
		const settingsCall = mockUseHotkeys.mock.calls.find(([shortcut]) => shortcut === "mod+shift+s");
		if (!settingsCall || typeof settingsCall[1] !== "function") {
			throw new Error("Expected settings shortcut to be registered.");
		}

		act(() => {
			const gitHistoryHandler = gitHistoryCall[1] as () => void;
			const settingsHandler = settingsCall[1] as () => void;
			gitHistoryHandler();
			settingsHandler();
		});

		expect(handleToggleGitHistory).toHaveBeenCalledTimes(1);
		expect(handleOpenSettings).toHaveBeenCalledTimes(1);
	});

	it("closes home git history on Escape", async () => {
		const handleCloseGitHistory = vi.fn();

		await act(async () => {
			root.render(
				<HookHarness
					selectedCard={null}
					isDetailTerminalOpen={false}
					isHomeTerminalOpen={false}
					isHomeGitHistoryOpen
					handleToggleDetailTerminal={() => {}}
					handleToggleHomeTerminal={() => {}}
					handleToggleExpandDetailTerminal={() => {}}
					handleToggleExpandHomeTerminal={() => {}}
					handleOpenCreateTask={() => {}}
					handleOpenSettings={() => {}}
					handleToggleGitHistory={() => {}}
					handleCloseGitHistory={handleCloseGitHistory}
					onStartAllTasks={() => {}}
				/>,
			);
		});

		const escapeCall = mockUseHotkeys.mock.calls.find(([shortcut]) => shortcut === "escape");
		if (!escapeCall || typeof escapeCall[1] !== "function") {
			throw new Error("Expected Escape shortcut to be registered.");
		}

		act(() => {
			const escapeHandler = escapeCall[1] as (event: KeyboardEvent) => void;
			escapeHandler(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
		});

		expect(handleCloseGitHistory).toHaveBeenCalledTimes(1);
	});

	it("starts all tasks on Alt+Shift+S", async () => {
		const onStartAllTasks = vi.fn();

		await act(async () => {
			root.render(
				<HookHarness
					selectedCard={null}
					isDetailTerminalOpen={false}
					isHomeTerminalOpen={false}
					isHomeGitHistoryOpen={false}
					handleToggleDetailTerminal={() => {}}
					handleToggleHomeTerminal={() => {}}
					handleToggleExpandDetailTerminal={() => {}}
					handleToggleExpandHomeTerminal={() => {}}
					handleOpenCreateTask={() => {}}
					handleOpenSettings={() => {}}
					handleToggleGitHistory={() => {}}
					handleCloseGitHistory={() => {}}
					onStartAllTasks={onStartAllTasks}
				/>,
			);
		});

		const startAllTasksCall = mockUseHotkeys.mock.calls.find(([shortcut]) => shortcut === "alt+shift+s");
		if (!startAllTasksCall || typeof startAllTasksCall[1] !== "function") {
			throw new Error("Expected start all tasks shortcut to be registered.");
		}

		act(() => {
			const startAllTasksHandler = startAllTasksCall[1] as () => void;
			startAllTasksHandler();
		});

		expect(onStartAllTasks).toHaveBeenCalledTimes(1);
	});
});
