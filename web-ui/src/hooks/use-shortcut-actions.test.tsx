import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useShortcutActions } from "@/hooks/use-shortcut-actions";

const saveRuntimeConfigMock = vi.hoisted(() => vi.fn());
const showAppToastMock = vi.hoisted(() => vi.fn());
const waitForTerminalLikelyPromptMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/runtime-config-query", () => ({
	saveRuntimeConfig: saveRuntimeConfigMock,
}));

vi.mock("@/components/app-toaster", () => ({
	showAppToast: showAppToastMock,
}));

vi.mock("@/terminal/terminal-controller-registry", () => ({
	waitForTerminalLikelyPrompt: waitForTerminalLikelyPromptMock,
}));

interface HookSnapshot {
	handleRunShortcut: ReturnType<typeof useShortcutActions>["handleRunShortcut"];
}

function requireSnapshot(snapshot: HookSnapshot | null): HookSnapshot {
	if (snapshot === null) {
		throw new Error("Expected a hook snapshot.");
	}
	return snapshot;
}

function HookHarness({
	onSnapshot,
	prepareTerminalForShortcut,
	sendTaskSessionInput,
}: {
	onSnapshot: (snapshot: HookSnapshot) => void;
	prepareTerminalForShortcut: Parameters<typeof useShortcutActions>[0]["prepareTerminalForShortcut"];
	sendTaskSessionInput: Parameters<typeof useShortcutActions>[0]["sendTaskSessionInput"];
}): null {
	const shortcutActions = useShortcutActions({
		currentProjectId: "project-1",
		selectedShortcutLabel: "Ship",
		shortcuts: [{ label: "Ship", command: "npm run ship" }],
		refreshRuntimeProjectConfig: () => {},
		prepareTerminalForShortcut,
		prepareWaitForTerminalConnectionReady: () => async () => {},
		sendTaskSessionInput,
	});

	useEffect(() => {
		onSnapshot({
			handleRunShortcut: shortcutActions.handleRunShortcut,
		});
	}, [onSnapshot, shortcutActions.handleRunShortcut]);

	return null;
}

describe("useShortcutActions", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		saveRuntimeConfigMock.mockReset();
		showAppToastMock.mockReset();
		waitForTerminalLikelyPromptMock.mockReset();
		waitForTerminalLikelyPromptMock.mockResolvedValue(true);
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

	it("interrupts reused terminals before sending the shortcut command", async () => {
		const prepareTerminalForShortcut = vi.fn(async () => ({
			ok: true,
			targetTaskId: "__home_terminal__",
		}));
		const sendTaskSessionInput = vi.fn(async () => ({ ok: true }));
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					prepareTerminalForShortcut={prepareTerminalForShortcut}
					sendTaskSessionInput={sendTaskSessionInput}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		await act(async () => {
			await requireSnapshot(latestSnapshot).handleRunShortcut("Ship");
		});

		expect(waitForTerminalLikelyPromptMock).toHaveBeenCalledWith("__home_terminal__", 3000);
		expect(sendTaskSessionInput).toHaveBeenNthCalledWith(1, "__home_terminal__", "\u0003", {
			appendNewline: false,
		});
		expect(sendTaskSessionInput).toHaveBeenNthCalledWith(2, "__home_terminal__", "npm run ship", {
			appendNewline: true,
		});
		expect(showAppToastMock).not.toHaveBeenCalled();
	});

	it("interrupts before running even for freshly opened terminals", async () => {
		const prepareTerminalForShortcut = vi.fn(async () => ({
			ok: true,
			targetTaskId: "__home_terminal__",
		}));
		const sendTaskSessionInput = vi.fn(async () => ({ ok: true }));
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					prepareTerminalForShortcut={prepareTerminalForShortcut}
					sendTaskSessionInput={sendTaskSessionInput}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		await act(async () => {
			await requireSnapshot(latestSnapshot).handleRunShortcut("Ship");
		});

		expect(waitForTerminalLikelyPromptMock).toHaveBeenCalledWith("__home_terminal__", 3000);
		expect(sendTaskSessionInput).toHaveBeenNthCalledWith(1, "__home_terminal__", "\u0003", {
			appendNewline: false,
		});
		expect(sendTaskSessionInput).toHaveBeenNthCalledWith(2, "__home_terminal__", "npm run ship", {
			appendNewline: true,
		});
	});
});
