/**
 * OAuth callback relay with retry logic.
 *
 * When the OS delivers a `kanban://oauth/callback` URL, the Electron shell
 * relays it to the runtime server via HTTP fetch. If the runtime is temporarily
 * unreachable (e.g. waking from sleep, mid-restart), a single fire-and-forget
 * fetch would silently lose the callback. This module wraps the relay in a
 * retry loop and notifies the user when all attempts are exhausted.
 */

import type { BrowserWindow } from "electron";
import { dialog } from "electron";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Dependencies injected for testability. */
export interface OAuthRelayDeps {
	/** The fetch implementation to use (defaults to global `fetch`). */
	fetch: typeof globalThis.fetch;
	/** Returns the main BrowserWindow, or null if unavailable. */
	getMainWindow: () => BrowserWindow | null;
}

// ---------------------------------------------------------------------------
// relayOAuthCallback
// ---------------------------------------------------------------------------

/**
 * Relay an OAuth callback to the runtime server with retry logic.
 *
 * Attempts the fetch up to `retries + 1` times (default: 3 total attempts)
 * with a 1 second delay between retries. If all attempts fail or return a
 * non-ok response, a warning dialog is shown to the user.
 *
 * @param relayUrl  The fully-qualified URL to fetch (runtime OAuth endpoint).
 * @param token     The auth token to include as a Bearer header, or null.
 * @param deps      Injectable dependencies for testability.
 * @param retries   Number of retry attempts after the first failure (default: 2).
 */
export async function relayOAuthCallback(
	relayUrl: string,
	token: string | null,
	deps: OAuthRelayDeps,
	retries = 2,
): Promise<void> {
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const response = await deps.fetch(relayUrl, {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			if (response.ok) return;
		} catch {
			/* retry */
		}
		if (attempt < retries) await new Promise((r) => setTimeout(r, 1_000));
	}

	// All retries exhausted — notify the user.
	const window = deps.getMainWindow();
	if (window && !window.isDestroyed()) {
		dialog.showMessageBox(window, {
			type: "warning",
			title: "OAuth Callback Failed",
			message:
				"The authentication callback could not be delivered. Please try again.",
			buttons: ["OK"],
		});
	}
}
