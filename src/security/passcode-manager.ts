/**
 * Passcode manager for remotely-hosted Kanban instances.
 *
 * Security properties:
 * - Passcode is generated via crypto.randomBytes — cryptographically secure.
 * - Passcode lives in-memory only — never written to disk, never in env vars.
 * - Each process has its own independent passcode.
 * - Comparison uses crypto.timingSafeEqual to prevent timing attacks.
 * - Sessions are random tokens stored in-memory with TTL metadata.
 * - Rate limiting: 5 failed attempts triggers a 30-second lockout.
 * - Passcode is NEVER returned in any response, log, or error message.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";

const PASSCODE_LENGTH = 8;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_LOCKOUT_MS = 30 * 1000; // 30 seconds

interface PasscodeState {
	value: string;
	issuedAt: number;
}

interface SessionEntry {
	issuedAt: number;
}

interface RateLimitEntry {
	attempts: number;
	lockedUntil: number | null;
}

const INTERNAL_TOKEN_ENV = "KANBAN_INTERNAL_AUTH_TOKEN";

let passcodeState: PasscodeState | null = null;
let passcodeEnabled = true;
let internalAuthToken: string | null = null;

const sessions = new Map<string, SessionEntry>();
const rateLimitByIp = new Map<string, RateLimitEntry>();

function generateRandomPasscode(): string {
	// Exclude visually ambiguous chars: 0/O, 1/I/l
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
	let result = "";
	while (result.length < PASSCODE_LENGTH) {
		const bytes = randomBytes(PASSCODE_LENGTH * 2);
		for (let i = 0; i < bytes.length && result.length < PASSCODE_LENGTH; i++) {
			const byte = bytes[i];
			if (byte === undefined) continue;
			// Rejection sampling to avoid modulo bias
			if (byte < chars.length * Math.floor(256 / chars.length)) {
				result += chars[byte % chars.length];
			}
		}
	}
	return result;
}

/**
 * Generate a new passcode. Called once at server startup when remote mode is active.
 * Returns the plaintext passcode for console display ONLY.
 */
export function generatePasscode(): string {
	const value = generateRandomPasscode();
	passcodeState = { value, issuedAt: Date.now() };
	passcodeEnabled = true;
	return value;
}

/** Disable passcode enforcement (--no-passcode flag). */
export function disablePasscode(): void {
	passcodeEnabled = false;
	passcodeState = null;
}

/** Whether passcode enforcement is currently active. */
export function isPasscodeEnabled(): boolean {
	return passcodeEnabled;
}

/**
 * Revoke the current passcode and generate a new one.
 * Returns the new plaintext passcode for display.
 */
export function revokeAndRegeneratePasscode(): string {
	sessions.clear();
	rateLimitByIp.clear();
	return generatePasscode();
}

/**
 * Validate a submitted passcode. Uses timing-safe comparison.
 */
export function validatePasscode(submitted: string): boolean {
	if (!passcodeEnabled || !passcodeState) return false;
	if (typeof submitted !== "string" || submitted.length === 0) return false;

	const expectedBuf = Buffer.from(passcodeState.value, "utf8");
	const submittedPadded = Buffer.alloc(expectedBuf.length, 0);
	const submittedBuf = Buffer.from(submitted, "utf8");
	submittedBuf.copy(submittedPadded, 0, 0, Math.min(submittedBuf.length, submittedPadded.length));

	const lengthMatch = submittedBuf.length === expectedBuf.length;
	const bytesMatch = timingSafeEqual(submittedPadded, expectedBuf);
	return lengthMatch && bytesMatch;
}

/** Issue a new session token after successful passcode verification. */
export function issueSession(): string {
	const token = randomBytes(32).toString("hex");
	sessions.set(token, { issuedAt: Date.now() });
	return token;
}

/** Validate a session token. Returns true if valid and not expired. */
export function validateSession(token: string): boolean {
	const entry = sessions.get(token);
	if (!entry) return false;
	if (Date.now() - entry.issuedAt > SESSION_TTL_MS) {
		sessions.delete(token);
		return false;
	}
	return true;
}

/** Extract the session token from a Cookie header string. */
export function extractSessionTokenFromCookie(cookieHeader: string | undefined): string | null {
	if (!cookieHeader) return null;
	for (const part of cookieHeader.split(";")) {
		const trimmed = part.trim();
		if (trimmed.startsWith("kanban_session=")) {
			const value = trimmed.slice("kanban_session=".length).trim();
			return value || null;
		}
	}
	return null;
}

export interface RateLimitResult {
	allowed: boolean;
	lockedUntilMs: number | null;
	attemptsRemaining: number;
}

/** Check rate limit for a given IP address before a passcode attempt. */
export function checkRateLimit(ip: string): RateLimitResult {
	const now = Date.now();
	let entry = rateLimitByIp.get(ip);
	if (!entry) {
		entry = { attempts: 0, lockedUntil: null };
		rateLimitByIp.set(ip, entry);
	}
	if (entry.lockedUntil !== null && now >= entry.lockedUntil) {
		entry.attempts = 0;
		entry.lockedUntil = null;
	}
	if (entry.lockedUntil !== null) {
		return { allowed: false, lockedUntilMs: entry.lockedUntil, attemptsRemaining: 0 };
	}
	return {
		allowed: true,
		lockedUntilMs: null,
		attemptsRemaining: Math.max(0, RATE_LIMIT_MAX_ATTEMPTS - entry.attempts),
	};
}

/** Record a failed passcode attempt for rate limiting. */
export function recordFailedAttempt(ip: string): void {
	const now = Date.now();
	let entry = rateLimitByIp.get(ip);
	if (!entry) {
		entry = { attempts: 0, lockedUntil: null };
		rateLimitByIp.set(ip, entry);
	}
	entry.attempts += 1;
	if (entry.attempts >= RATE_LIMIT_MAX_ATTEMPTS) {
		entry.lockedUntil = now + RATE_LIMIT_LOCKOUT_MS;
	}
}

/** Clear rate limit for a given IP after a successful verification. */
export function clearRateLimit(ip: string): void {
	rateLimitByIp.delete(ip);
}

// ── Internal CLI auth token ──────────────────────────────────────────────
// A separate bearer token used by CLI sub-processes (hooks ingest, task
// commands) to authenticate against the runtime server without the
// browser-facing passcode flow.  The token is:
//   • Generated once alongside the passcode (or when explicitly requested).
//   • Stored in-memory AND propagated via the KANBAN_INTERNAL_AUTH_TOKEN env
//     var so that child processes (spawned terminals, detached hook commands)
//     inherit it automatically.
//   • Never exposed to browser clients.

/**
 * Generate (or regenerate) the internal CLI auth token.
 * Called by the server at startup when remote-mode passcode is active.
 * The token is stored in-memory and written to `process.env` so that
 * child processes inherit it.
 */
export function generateInternalToken(): string {
	const token = randomBytes(32).toString("hex");
	internalAuthToken = token;
	process.env[INTERNAL_TOKEN_ENV] = token;
	return token;
}

/**
 * Return the current internal token, reading from the env var if needed
 * (this covers CLI sub-processes that were spawned by the server).
 */
export function getInternalToken(): string | null {
	return internalAuthToken ?? process.env[INTERNAL_TOKEN_ENV]?.trim() ?? null;
}

/**
 * Validate an internal bearer token.  Uses timing-safe comparison.
 * Returns `true` if the submitted token matches the active internal token.
 */
export function validateInternalToken(submitted: string): boolean {
	const expected = internalAuthToken;
	if (!expected) return false;
	if (typeof submitted !== "string" || submitted.length === 0) return false;

	const expectedBuf = Buffer.from(expected, "utf8");
	const submittedBuf = Buffer.from(submitted, "utf8");
	if (expectedBuf.length !== submittedBuf.length) return false;

	return timingSafeEqual(submittedBuf, expectedBuf);
}

/**
 * Extract a bearer token from an Authorization header value.
 * Returns the raw token string or `null` if the header is absent / malformed.
 */
export function extractBearerToken(authorizationHeader: string | undefined): string | null {
	if (!authorizationHeader) return null;
	const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader);
	return match?.[1] ?? null;
}

/** Name of the env var used to propagate the internal token to child processes. */
export { INTERNAL_TOKEN_ENV };
