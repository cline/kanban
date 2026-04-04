import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock Electron's dialog module before importing the module under test.
// ---------------------------------------------------------------------------

const { showMessageBoxMock } = vi.hoisted(() => ({
	showMessageBoxMock: vi.fn(),
}));

vi.mock("electron", () => ({
	dialog: {
		showMessageBox: showMessageBoxMock,
	},
}));

import {
	showDesktopFailureDialog,
	type DesktopFailureState,
	type DesktopFailureAction,
} from "../src/desktop-failure.js";
import type { BrowserWindow } from "electron";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal BrowserWindow stub — only the reference matters, dialog owns the logic. */
const fakeWindow = {} as BrowserWindow;

function makeFailure(overrides: Partial<DesktopFailureState> = {}): DesktopFailureState {
	return {
		code: "WSL_RUNTIME_START_FAILED",
		title: "WSL Runtime Failed",
		message: "Something went wrong",
		canRetry: false,
		canFallbackToLocal: false,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("showDesktopFailureDialog", () => {
	beforeEach(() => { showMessageBoxMock.mockReset(); });

	it("returns 'retry' when the user clicks the Retry button", async () => {
		const failure = makeFailure({ canRetry: true, canFallbackToLocal: false });
		// Buttons: ["Retry", "Close"] → index 0 = Retry
		showMessageBoxMock.mockResolvedValueOnce({ response: 0 });

		const result = await showDesktopFailureDialog(fakeWindow, failure);
		expect(result).toBe("retry");
	});

	it("returns 'fallback-local' when the user clicks Switch to Local", async () => {
		const failure = makeFailure({ canRetry: false, canFallbackToLocal: true });
		// Buttons: ["Switch to Local", "Close"] → index 0 = Switch to Local
		showMessageBoxMock.mockResolvedValueOnce({ response: 0 });

		const result = await showDesktopFailureDialog(fakeWindow, failure);
		expect(result).toBe("fallback-local");
	});

	it("returns 'dismiss' when the user clicks Close", async () => {
		const failure = makeFailure({ canRetry: false, canFallbackToLocal: false });
		// Buttons: ["Close"] → index 0 = Close
		showMessageBoxMock.mockResolvedValueOnce({ response: 0 });

		const result = await showDesktopFailureDialog(fakeWindow, failure);
		expect(result).toBe("dismiss");
	});

	it("includes Retry button when canRetry is true", async () => {
		const failure = makeFailure({ canRetry: true });
		showMessageBoxMock.mockResolvedValueOnce({ response: 0 });

		await showDesktopFailureDialog(fakeWindow, failure);

		const callArgs = showMessageBoxMock.mock.calls[0];
		const options = callArgs[1] as { buttons: string[] };
		expect(options.buttons).toContain("Retry");
	});

	it("includes Switch to Local button when canFallbackToLocal is true", async () => {
		const failure = makeFailure({ canFallbackToLocal: true });
		showMessageBoxMock.mockResolvedValueOnce({ response: 0 });

		await showDesktopFailureDialog(fakeWindow, failure);

		const callArgs = showMessageBoxMock.mock.calls[0];
		const options = callArgs[1] as { buttons: string[] };
		expect(options.buttons).toContain("Switch to Local");
	});

	it("always includes Close button as the last option", async () => {
		const failure = makeFailure({ canRetry: true, canFallbackToLocal: true });
		showMessageBoxMock.mockResolvedValueOnce({ response: 0 });

		await showDesktopFailureDialog(fakeWindow, failure);

		const callArgs = showMessageBoxMock.mock.calls[0];
		const options = callArgs[1] as { buttons: string[] };
		const buttons = options.buttons;
		expect(buttons[buttons.length - 1]).toBe("Close");
	});

	it("maps button indices correctly when all options are present", async () => {
		const failure = makeFailure({ canRetry: true, canFallbackToLocal: true });
		// Buttons: ["Retry", "Switch to Local", "Close"]

		// Click "Switch to Local" (index 1)
		showMessageBoxMock.mockResolvedValueOnce({ response: 1 });
		const result1 = await showDesktopFailureDialog(fakeWindow, failure);
		expect(result1).toBe("fallback-local");

		// Click "Close" (index 2)
		showMessageBoxMock.mockResolvedValueOnce({ response: 2 });
		const result2 = await showDesktopFailureDialog(fakeWindow, failure);
		expect(result2).toBe("dismiss");

		// Click "Retry" (index 0)
		showMessageBoxMock.mockResolvedValueOnce({ response: 0 });
		const result3 = await showDesktopFailureDialog(fakeWindow, failure);
		expect(result3).toBe("retry");
	});

	it("defaults to 'dismiss' for out-of-range response index", async () => {
		const failure = makeFailure({ canRetry: true });
		// Unexpected high index
		showMessageBoxMock.mockResolvedValueOnce({ response: 99 });

		const result = await showDesktopFailureDialog(fakeWindow, failure);
		expect(result).toBe("dismiss");
	});

	it("passes the correct dialog options to showMessageBox", async () => {
		const failure = makeFailure({
			title: "Test Title",
			message: "Test message detail",
			canRetry: true,
			canFallbackToLocal: false,
		});
		showMessageBoxMock.mockResolvedValueOnce({ response: 0 });

		await showDesktopFailureDialog(fakeWindow, failure);

		expect(showMessageBoxMock).toHaveBeenCalledWith(fakeWindow, {
			type: "error",
			title: "Test Title",
			message: "Test Title",
			detail: "Test message detail",
			buttons: ["Retry", "Close"],
			defaultId: 0,
			cancelId: 1,
		});
	});
});
