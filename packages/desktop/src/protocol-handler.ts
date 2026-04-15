/**
 * Custom protocol handler for kanban:// deep-links.
 *
 * Responsible for:
 * - Registering `kanban://` as the app's default protocol on the OS
 * - Parsing incoming kanban:// URLs into a structured result
 * - Providing helpers to extract OAuth callback parameters (code, state, error)
 *
 * The protocol is used by external OAuth providers to redirect back to the
 * desktop app after authentication completes. A typical flow:
 *
 *   1. The app opens the system browser to the OAuth provider's authorize URL,
 *      with redirect_uri=kanban://oauth/callback
 *   2. After the user authenticates, the provider redirects to kanban://oauth/callback?code=...&state=...
 *   3. The OS routes the kanban:// URL to this app (via open-url on macOS,
 *      or as a command-line argument on Windows/Linux)
 *   4. This module parses the URL and emits the result so the runtime can
 *      complete the token exchange
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The protocol scheme registered with the OS (without the "://" suffix). */
export const KANBAN_PROTOCOL = "kanban";

/** The pathname expected for OAuth callbacks. */
export const OAUTH_CALLBACK_PATH = "/oauth/callback";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** OAuth-specific parameters extracted from a kanban:// callback URL. */
export interface OAuthCallbackParams {
	/** The authorization code returned by the provider. */
	code: string | null;
	/** The state parameter for CSRF verification. */
	state: string | null;
	/** An error code if the provider denied the request. */
	error: string | null;
	/** A human-readable error description. */
	errorDescription: string | null;
}

/** Structured result from parsing a kanban:// URL. */
export interface ParsedProtocolUrl {
	/** The raw URL string that was parsed. */
	raw: string;
	/** The pathname portion (e.g. "/oauth/callback"). */
	pathname: string;
	/** The full search params map. */
	searchParams: URLSearchParams;
	/** Whether this URL matches the OAuth callback path. */
	isOAuthCallback: boolean;
	/** OAuth params — only meaningful when `isOAuthCallback` is true. */
	oauth: OAuthCallbackParams;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a `kanban://` URL into a structured result.
 *
 * Returns `null` if the URL is not a valid `kanban://` URL.
 *
 * This function is pure and does not depend on Electron, making it
 * straightforward to test in a plain Node.js environment.
 */
export function parseProtocolUrl(raw: string): ParsedProtocolUrl | null {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}

	// Only accept kanban: scheme.
	if (url.protocol !== `${KANBAN_PROTOCOL}:`) {
		return null;
	}

	// URL constructor treats kanban://oauth/callback as:
	//   protocol = "kanban:", hostname = "oauth", pathname = "/callback"
	// We normalise so the "logical" pathname is /oauth/callback.
	const pathname = `/${url.hostname}${url.pathname}`.replace(/\/+$/, "") || "/";

	const searchParams = url.searchParams;

	const isOAuthCallback = pathname === OAUTH_CALLBACK_PATH;

	const oauth: OAuthCallbackParams = {
		code: searchParams.get("code"),
		state: searchParams.get("state"),
		error: searchParams.get("error"),
		errorDescription: searchParams.get("error_description"),
	};

	return {
		raw,
		pathname,
		searchParams,
		isOAuthCallback,
		oauth,
	};
}

// ---------------------------------------------------------------------------
// Protocol registration
// ---------------------------------------------------------------------------

/**
 * Minimal subset of `Electron.App` needed for protocol registration.
 *
 * Keeps this module testable without importing the full Electron types at
 * runtime — mirrors the pattern used in auth.ts.
 */
export interface ElectronAppLike {
	setAsDefaultProtocolClient(protocol: string): boolean;
	isDefaultProtocolClient(protocol: string): boolean;
}

/**
 * Register `kanban://` as the default protocol client for this app.
 *
 * On macOS, protocol associations are declared in the Info.plist (handled by
 * electron-builder), but `setAsDefaultProtocolClient` is still called for
 * development builds. On Windows/Linux, this call registers the protocol
 * in the OS registry / XDG system.
 *
 * Returns `true` if the registration succeeded (or was already registered).
 */
export function registerProtocol(electronApp: ElectronAppLike): boolean {
	if (electronApp.isDefaultProtocolClient(KANBAN_PROTOCOL)) {
		return true;
	}
	return electronApp.setAsDefaultProtocolClient(KANBAN_PROTOCOL);
}

// ---------------------------------------------------------------------------
// URL extraction from argv (Windows/Linux)
// ---------------------------------------------------------------------------

/**
 * Extract a `kanban://` URL from a process argv array.
 *
 * On Windows and Linux, when the app is launched via a protocol link, the URL
 * is passed as a command-line argument. This helper scans argv for the first
 * argument that starts with `kanban://`.
 *
 * Returns `null` if no protocol URL is found.
 */
export function extractProtocolUrlFromArgv(argv: readonly string[]): string | null {
	const prefix = `${KANBAN_PROTOCOL}://`;
	for (const arg of argv) {
		if (arg.startsWith(prefix)) {
			return arg;
		}
	}
	return null;
}
