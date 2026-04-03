/**
 * Unit tests for the WebSocket upgrade passcode gate in runtime-server.ts.
 *
 * The gate must reject unauthenticated upgrade requests to /api/runtime/ws
 * with HTTP 401 when remote mode + passcode are active, and allow them through
 * when the session cookie is valid or when the gate is not active.
 *
 * We test the gate by exercising the passcode-manager helpers directly (the
 * same helpers the upgrade handler calls) rather than spinning up a full
 * runtime server, keeping the test fast and deterministic.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
	disablePasscode,
	extractSessionTokenFromCookie,
	generatePasscode,
	isPasscodeEnabled,
	issueSession,
	validateSession,
} from "../../../src/security/passcode-manager";

// ---------------------------------------------------------------------------
// Helper: simulate the exact guard logic from the upgrade handler so we can
// assert on all branch outcomes without a real HTTP server.
// ---------------------------------------------------------------------------
function runUpgradeGuard(input: { isRemoteMode: boolean; cookieHeader: string | undefined }): "allowed" | "rejected" {
	const passcodeActive = input.isRemoteMode && isPasscodeEnabled();
	if (passcodeActive) {
		const token = extractSessionTokenFromCookie(input.cookieHeader);
		const authenticated = token !== null && validateSession(token);
		if (!authenticated) {
			return "rejected";
		}
	}
	return "allowed";
}

describe("WebSocket upgrade passcode gate (/api/runtime/ws)", () => {
	// Reset passcode state after each test so tests do not bleed into each other.
	afterEach(() => {
		// Re-enable the passcode with a fresh value so the module state is clean.
		// (disablePasscode sets passcodeEnabled = false; generatePasscode resets it.)
		generatePasscode();
	});

	it("rejects upgrade when remote mode is active, passcode is enabled, and no cookie is sent", () => {
		generatePasscode(); // ensure passcode is active
		expect(isPasscodeEnabled()).toBe(true);

		const result = runUpgradeGuard({ isRemoteMode: true, cookieHeader: undefined });
		expect(result).toBe("rejected");
	});

	it("rejects upgrade when remote mode is active and the session token is invalid", () => {
		generatePasscode();

		const result = runUpgradeGuard({
			isRemoteMode: true,
			cookieHeader: "kanban_session=not-a-real-token",
		});
		expect(result).toBe("rejected");
	});

	it("rejects upgrade when remote mode is active and the cookie contains a garbage value", () => {
		generatePasscode();

		const result = runUpgradeGuard({
			isRemoteMode: true,
			cookieHeader: "some_other_cookie=abc; kanban_session=",
		});
		expect(result).toBe("rejected");
	});

	it("allows upgrade when remote mode is active and the session token is valid", () => {
		generatePasscode();
		const token = issueSession();

		const result = runUpgradeGuard({
			isRemoteMode: true,
			cookieHeader: `kanban_session=${token}`,
		});
		expect(result).toBe("allowed");
	});

	it("allows upgrade when remote mode is active and the session cookie is mixed with other cookies", () => {
		generatePasscode();
		const token = issueSession();

		const result = runUpgradeGuard({
			isRemoteMode: true,
			cookieHeader: `other=value; kanban_session=${token}; another=x`,
		});
		expect(result).toBe("allowed");
	});

	it("allows upgrade when NOT in remote mode even without a valid session cookie", () => {
		generatePasscode();

		// isRemoteMode = false → gate is skipped entirely
		const result = runUpgradeGuard({ isRemoteMode: false, cookieHeader: undefined });
		expect(result).toBe("allowed");
	});

	it("rejects upgrade when cookie contains a token that was never issued by this server", () => {
		generatePasscode();
		// This 64-char hex string resembles a session token but was never issued by issueSession().
		const neverIssuedToken = "a".repeat(64);
		expect(validateSession(neverIssuedToken)).toBe(false);

		const result = runUpgradeGuard({
			isRemoteMode: true,
			cookieHeader: `kanban_session=${neverIssuedToken}`,
		});
		expect(result).toBe("rejected");
	});

	it("allows upgrade when passcode is disabled (--no-passcode flag) even in remote mode", () => {
		disablePasscode();
		expect(isPasscodeEnabled()).toBe(false);

		const result = runUpgradeGuard({ isRemoteMode: true, cookieHeader: undefined });
		expect(result).toBe("allowed");
	});
});
