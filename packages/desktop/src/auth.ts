/**
 * Auth token generation for the Electron ↔ runtime child process handshake.
 *
 * Stub for Task 1.3. Will be responsible for:
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

/**
 * Generate a cryptographically random auth token.
 *
 * Returns a 64-character hex string suitable for use as a Bearer token.
 */
export function generateAuthToken(): string {
	return randomBytes(AUTH_TOKEN_BYTE_LENGTH).toString("hex");
}

/**
 * Install the auth token as an Authorization header on all requests made
 * by the given Electron BrowserWindow session.
 *
 * Stub — the session.webRequest wiring will be implemented in Task 1.3.
 */
export function installAuthHeaderInterceptor(
	_session: unknown,
	_token: string,
	_runtimeOrigin: string,
): void {
	// TODO (Task 1.3): Use session.webRequest.onBeforeSendHeaders to add
	// Authorization: Bearer <token> to all requests matching runtimeOrigin.
	throw new Error("installAuthHeaderInterceptor() is not yet implemented (Task 1.3)");
}
