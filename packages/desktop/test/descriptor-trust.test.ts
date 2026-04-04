import { afterEach, describe, expect, it, vi } from "vitest";

import {
	type DescriptorTrustResult,
	type RuntimeDescriptor,
	clearRuntimeDescriptor,
	evaluateDescriptorTrust,
	isDesktopDescriptorFromCurrentSession,
	readRuntimeDescriptor,
	writeRuntimeDescriptor,
} from "../../../src/core/runtime-descriptor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function makeDescriptor(
	overrides: Partial<RuntimeDescriptor> = {},
): RuntimeDescriptor {
	return {
		url: "http://127.0.0.1:54321",
		authToken: "test-token",
		pid: process.pid,
		updatedAt: new Date().toISOString(),
		source: "desktop",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

afterEach(async () => {
	await clearRuntimeDescriptor().catch(() => {});
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// isDesktopDescriptorFromCurrentSession
// ---------------------------------------------------------------------------

describe("isDesktopDescriptorFromCurrentSession", () => {
	it("returns true when source is desktop and session IDs match", () => {
		const d = makeDescriptor({ desktopSessionId: SESSION_A });
		expect(isDesktopDescriptorFromCurrentSession(d, SESSION_A)).toBe(true);
	});

	it("returns false when session IDs differ", () => {
		const d = makeDescriptor({ desktopSessionId: SESSION_A });
		expect(isDesktopDescriptorFromCurrentSession(d, SESSION_B)).toBe(false);
	});

	it("returns false when descriptor has no desktopSessionId", () => {
		const d = makeDescriptor({ desktopSessionId: undefined });
		expect(isDesktopDescriptorFromCurrentSession(d, SESSION_A)).toBe(false);
	});

	it("returns false when source is cli even if session ID matches", () => {
		const d = makeDescriptor({ source: "cli", desktopSessionId: SESSION_A });
		expect(isDesktopDescriptorFromCurrentSession(d, SESSION_A)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// evaluateDescriptorTrust
// ---------------------------------------------------------------------------

describe("evaluateDescriptorTrust", () => {
	it("returns no-descriptor when no descriptor file exists", async () => {
		await clearRuntimeDescriptor().catch(() => {});

		const result = await evaluateDescriptorTrust(SESSION_A);
		expect(result).toEqual<DescriptorTrustResult>({
			trusted: false,
			reason: "no-descriptor",
			descriptor: null,
		});
	});

	it("trusts a terminal-owned (cli) descriptor", async () => {
		const d = makeDescriptor({ source: "cli" });
		await writeRuntimeDescriptor(d);

		const result = await evaluateDescriptorTrust(SESSION_A);
		expect(result.trusted).toBe(true);
		expect(result.reason).toBe("terminal-owned");
		expect(result.descriptor).toMatchObject({ source: "cli" });
	});

	it("trusts a desktop descriptor from the current session", async () => {
		const d = makeDescriptor({ desktopSessionId: SESSION_A });
		await writeRuntimeDescriptor(d);

		const result = await evaluateDescriptorTrust(SESSION_A);
		expect(result.trusted).toBe(true);
		expect(result.reason).toBe("current-session");
		expect(result.descriptor).toMatchObject({ desktopSessionId: SESSION_A });
	});

	it("cleans up and returns pid-dead for stale descriptor from prior session", async () => {
		const deadPid = 2_147_483_646;
		const d = makeDescriptor({ pid: deadPid, desktopSessionId: SESSION_B });
		await writeRuntimeDescriptor(d);

		const result = await evaluateDescriptorTrust(SESSION_A);
		expect(result.trusted).toBe(false);
		expect(result.reason).toBe("pid-dead");
		expect(result.descriptor).toMatchObject({ pid: deadPid, desktopSessionId: SESSION_B });

		// Descriptor should be cleaned up from disk.
		const afterRead = await readRuntimeDescriptor();
		expect(afterRead).toBeNull();
	});

	it("returns prior-desktop-session for live PID from different session", async () => {
		const d = makeDescriptor({ pid: process.pid, desktopSessionId: SESSION_B });
		await writeRuntimeDescriptor(d);

		const result = await evaluateDescriptorTrust(SESSION_A);
		expect(result.trusted).toBe(false);
		expect(result.reason).toBe("prior-desktop-session");
		expect(result.descriptor).toMatchObject({ pid: process.pid, desktopSessionId: SESSION_B });

		// Descriptor should NOT be cleaned up (orphan policy deferred).
		const afterRead = await readRuntimeDescriptor();
		expect(afterRead).not.toBeNull();
	});

	it("returns pid-dead for descriptor without desktopSessionId and dead PID", async () => {
		const deadPid = 2_147_483_646;
		const d = makeDescriptor({ pid: deadPid, desktopSessionId: undefined });
		await writeRuntimeDescriptor(d);

		const result = await evaluateDescriptorTrust(SESSION_A);
		expect(result.trusted).toBe(false);
		expect(result.reason).toBe("pid-dead");

		const afterRead = await readRuntimeDescriptor();
		expect(afterRead).toBeNull();
	});

	it("returns prior-desktop-session for descriptor without desktopSessionId and live PID", async () => {
		const d = makeDescriptor({ pid: process.pid, desktopSessionId: undefined });
		await writeRuntimeDescriptor(d);

		const result = await evaluateDescriptorTrust(SESSION_A);
		expect(result.trusted).toBe(false);
		expect(result.reason).toBe("prior-desktop-session");
	});
});

// ---------------------------------------------------------------------------
// desktopSessionId round-trip via descriptor write/read
// ---------------------------------------------------------------------------

describe("RuntimeDescriptor desktopSessionId round-trip", () => {
	it("writes and reads back the desktopSessionId field", async () => {
		const d = makeDescriptor({ desktopSessionId: SESSION_A });
		await writeRuntimeDescriptor(d);

		const read = await readRuntimeDescriptor();
		expect(read).not.toBeNull();
		expect(read!.desktopSessionId).toBe(SESSION_A);
	});

	it("reads descriptors without desktopSessionId (backward compat)", async () => {
		const d = makeDescriptor({ desktopSessionId: undefined });
		await writeRuntimeDescriptor(d);

		const read = await readRuntimeDescriptor();
		expect(read).not.toBeNull();
		expect(read!.desktopSessionId).toBeUndefined();
	});
});
