/**
 * Desktop failure state and native failure dialog.
 *
 * Provides a structured way to present startup/runtime failures to the
 * user via Electron's native `dialog.showMessageBox`, offering contextual
 * actions like retry, fallback to local, or quit.
 */

import { type BrowserWindow, dialog } from "electron";
import type { DesktopFailureCode } from "./desktop-failure-codes.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DesktopFailureState {
	code: DesktopFailureCode;
	title: string;
	message: string;
	canRetry: boolean;
	canFallbackToLocal: boolean;
}

export type DesktopFailureAction = "retry" | "fallback-local" | "dismiss";

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

/**
 * Show a native failure dialog with contextual action buttons.
 *
 * Returns the action the user chose:
 * - `'retry'`          — the user wants to retry the failed operation
 * - `'fallback-local'` — the user wants to fall back to a local connection
 * - `'dismiss'`        — the user dismissed / chose to quit
 */
export async function showDesktopFailureDialog(
	window: BrowserWindow,
	failure: DesktopFailureState,
): Promise<DesktopFailureAction> {
	// Build the button list and a parallel mapping to actions.
	const buttons: string[] = [];
	const actions: DesktopFailureAction[] = [];

	if (failure.canRetry) {
		buttons.push("Retry");
		actions.push("retry");
	}
	if (failure.canFallbackToLocal) {
		buttons.push("Switch to Local");
		actions.push("fallback-local");
	}
	buttons.push("Close");
	actions.push("dismiss");

	const { response } = await dialog.showMessageBox(window, {
		type: "error",
		title: failure.title,
		message: failure.title,
		detail: failure.message,
		buttons,
		defaultId: 0,
		cancelId: buttons.length - 1,
	});

	return actions[response] ?? "dismiss";
}
