/**
 * Auth token generation for the Electron ↔ runtime child process handshake.
 *
 * Responsible for:
 * - Generating a cryptographically random ephemeral auth token on each app launch
 * - Injecting the token into the BrowserWindow's request headers via
 *   session.webRequest.onBeforeSendHeaders
 * - Passing the token to the runtime child process via the "start" IPC message
 *
 * The token is never persisted to disk — it lives only in memory for the
 * duration of the Electron process.
 */

import { randomBytes } from "node:crypto";

/** Length of the generated auth token in bytes (64 hex chars). */
const AUTH_TOKEN_BYTE_LENGTH = 32;

/** HTTP header name used to carry the auth token. */
export const AUTH_HEADER_NAME = "Authorization";

// ---------------------------------------------------------------------------
// Minimal Electron session type surface — keeps this module testable without
// importing the full Electron types at runtime.
// ---------------------------------------------------------------------------

/** Callback signature expected by Electron's onBeforeSendHeaders. */
export type BeforeSendHeadersCallback = (details: {
	requestHeaders: Record<string, string>;
}) => void;

/** The details object Electron passes to the onBeforeSendHeaders listener. */
export interface BeforeSendHeadersDetails {
	url: string;
	requestHeaders: Record<string, string>;
}

/** Minimal subset of Electron's `Session` that we actually need. */
export interface ElectronSessionLike {
	webRequest: {
		onBeforeSendHeaders: {
			(
				filter: { urls: string[] },
				listener:
					| ((
							details: BeforeSendHeadersDetails,
							callback: BeforeSendHeadersCallback,
					  ) => void)
					| null,
			): void;
			(
				listener:
					| ((
							details: BeforeSendHeadersDetails,
							callback: BeforeSendHeadersCallback,
					  ) => void)
					| null,
			): void;
		};
	};
}

/**
 * Generate a cryptographically random auth token.
 *
 * Returns a 64-character hex string suitable for use as a Bearer token.
 */
export function generateAuthToken(): string {
	return randomBytes(AUTH_TOKEN_BYTE_LENGTH).toString("hex");
}

/**
 * Extract the host authority (host + port) from a runtime URL.
 *
 * The runtime URL may include a path prefix (e.g. "/kanban") which is
 * irrelevant for matching — API requests use "/api/..." paths at the root.
 * We extract only the host:port so we can match any request to the runtime
 * server regardless of scheme (http, ws) or path.
 */
export function extractRuntimeAuthority(runtimeOrigin: string): string {
	const url = new URL(runtimeOrigin);
	return url.host;
}

/**
 * Check whether a request URL targets the given runtime authority.
 *
 * Matches both HTTP (http://) and WebSocket (ws://) schemes by comparing
 * only the host:port portion of the URL.
 */
export function isRuntimeRequest(requestUrl: string, runtimeAuthority: string): boolean {
	try {
		const url = new URL(requestUrl);
		return url.host === runtimeAuthority;
	} catch {
		return false;
	}
}

/**
 * Install the auth token as an Authorization header on all requests made
 * by the given Electron BrowserWindow session that target the runtime origin.
 *
 * Uses `session.webRequest.onBeforeSendHeaders` without a URL filter so that
 * both HTTP (http://) and WebSocket upgrade (ws://) requests are intercepted.
 * Chromium's webRequest URL patterns don't match ws:// URLs against http://
 * filters, so we match by host:port in the callback instead.
 *
 * Returns a dispose function that removes the interceptor.
 */
export function installAuthHeaderInterceptor(
	session: ElectronSessionLike,
	token: string,
	runtimeOrigin: string,
): () => void {
	const authority = extractRuntimeAuthority(runtimeOrigin);

	session.webRequest.onBeforeSendHeaders((details, callback) => {
		if (isRuntimeRequest(details.url, authority)) {
			const requestHeaders = { ...details.requestHeaders };
			requestHeaders[AUTH_HEADER_NAME] = `Bearer ${token}`;
			callback({ requestHeaders });
		} else {
			callback({ requestHeaders: details.requestHeaders });
		}
	});

	return () => {
		// Remove the handler by passing null (no-filter overload).
		session.webRequest.onBeforeSendHeaders(null);
	};
}
