import type { BrowserWindow } from "electron";
import { dialog } from "electron";

const RETRY_DELAY_MS = 1_000;

export interface OAuthRelayDeps {
	fetch: typeof globalThis.fetch;
	getMainWindow: () => BrowserWindow | null;
}

export async function relayOAuthCallback(
	relayUrl: string,
	deps: OAuthRelayDeps,
	retries = 2,
): Promise<void> {
	let lastFailure: string | null = null;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const response = await deps.fetch(relayUrl);
			if (response.ok) return;
			lastFailure = `HTTP ${response.status}`;
		} catch (err) {
			lastFailure = err instanceof Error ? err.message : String(err);
		}
		if (attempt < retries) {
			await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
		}
	}


	console.error(
		`[desktop] OAuth relay failed after ${retries + 1} attempts${
			lastFailure ? ` (last: ${lastFailure})` : ""
		}`,
	);
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
