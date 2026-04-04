import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type OrphanCleanupResult,
	type OrphanDescriptor,
	attemptOrphanCleanup,
	waitForPidDeath,
} from "../src/orphan-cleanup.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the "kanban" module — only clearRuntimeDescriptor is used.
vi.mock("kanban", () => ({
	clearRuntimeDescriptor: vi.fn(async () => {}),
}));

// Import the mocked clearRuntimeDescriptor so we can assert on it.
import { clearRuntimeDescriptor } from "kanban";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDescriptor(pid: number): OrphanDescriptor {
	return { pid };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.restoreAllMocks();
	// clearRuntimeDescriptor is a module-level mock from vi.mock("kanban").
	// restoreAllMocks doesn't clear its call history — must explicitly clear.
	vi.mocked(clearRuntimeDescriptor).mockClear();
	vi.mocked(clearRuntimeDescriptor).mockResolvedValue(undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// waitForPidDeath
// ---------------------------------------------------------------------------

describe("waitForPidDeath", () => {
	it("returns true immediately when the PID does not exist", async () => {
		// PID 2_147_483_646 is extremely unlikely to be a running process.
		const result = await waitForPidDeath(2_147_483_646, 500);
		expect(result).toBe(true);
	});

	it("returns false when the PID is alive and timeout elapses", async () => {
		// process.pid is always alive during the test.
		const result = await waitForPidDeath(process.pid, 300);
		expect(result).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// attemptOrphanCleanup
// ---------------------------------------------------------------------------

describe("attemptOrphanCleanup", () => {
	it("sends SIGTERM then clears descriptor on death", async () => {
		// Use a mock to simulate: process.kill SIGTERM succeeds,
		// then the process dies (ESRCH on the next kill(pid, 0) check).
		const killSpy = vi.spyOn(process, "kill").mockImplementation(
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			(pid: number, signal?: string | number): any => {
				if (signal === "SIGTERM") return true;
				if (signal === 0) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
				return true;
			},
		);

		const result = await attemptOrphanCleanup(makeDescriptor(99999));
		expect(result).toEqual<OrphanCleanupResult>({
			cleaned: true,
			method: "SIGTERM",
		});
		expect(clearRuntimeDescriptor).toHaveBeenCalled();

		// Verify SIGTERM was sent.
		expect(killSpy).toHaveBeenCalledWith(99999, "SIGTERM");

		killSpy.mockRestore();
	});

	it("escalates to SIGKILL after SIGTERM timeout", async () => {
		// Simulate: SIGTERM succeeds, PID stays alive through the 3 s wait,
		// then dies after SIGKILL.
		let sigkillSent = false;
		const killSpy = vi.spyOn(process, "kill").mockImplementation(
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			(pid: number, signal?: string | number): any => {
				if (signal === "SIGTERM") return true;
				if (signal === "SIGKILL") {
					sigkillSent = true;
					return true;
				}
				if (signal === 0) {
					// After SIGKILL, report dead; before, report alive.
					if (sigkillSent) {
						throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
					}
					return true; // still alive
				}
				return true;
			},
		);

		const result = await attemptOrphanCleanup(makeDescriptor(99999), {
			sigtermTimeoutMs: 300,
			sigkillTimeoutMs: 300,
		});
		expect(result).toEqual<OrphanCleanupResult>({
			cleaned: true,
			method: "SIGKILL",
		});
		expect(clearRuntimeDescriptor).toHaveBeenCalled();
		expect(sigkillSent).toBe(true);

		killSpy.mockRestore();
	});

	it("handles ESRCH (process already dead) gracefully", async () => {
		const killSpy = vi.spyOn(process, "kill").mockImplementation(
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			(_pid: number, _signal?: string | number): any => {
				throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
			},
		);

		const result = await attemptOrphanCleanup(makeDescriptor(99999));
		expect(result).toEqual<OrphanCleanupResult>({
			cleaned: true,
			method: "already-dead",
		});
		expect(clearRuntimeDescriptor).toHaveBeenCalled();

		killSpy.mockRestore();
	});

	it("returns failed when process refuses to die", async () => {
		// Simulate: all kill calls succeed but PID is always alive.
		// Use short timeouts to avoid real 5s wait + OOM.
		const killSpy = vi.spyOn(process, "kill").mockImplementation(
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			(_pid: number, _signal?: string | number): any => {
				return true; // always succeeds, PID never dies
			},
		);

		const result = await attemptOrphanCleanup(makeDescriptor(99999), {
			sigtermTimeoutMs: 300,
			sigkillTimeoutMs: 300,
		});
		expect(result).toEqual<OrphanCleanupResult>({
			cleaned: false,
			method: "failed",
		});
		expect(clearRuntimeDescriptor).not.toHaveBeenCalled();

		killSpy.mockRestore();
	});

	it("returns error result for unexpected kill errors (e.g. EPERM)", async () => {
		const killSpy = vi.spyOn(process, "kill").mockImplementation(
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			(_pid: number, _signal?: string | number): any => {
				throw Object.assign(new Error("EPERM"), { code: "EPERM" });
			},
		);

		const result = await attemptOrphanCleanup(makeDescriptor(99999));
		expect(result).toEqual<OrphanCleanupResult>({
			cleaned: false,
			method: "error:EPERM",
		});
		expect(clearRuntimeDescriptor).not.toHaveBeenCalled();

		killSpy.mockRestore();
	});
});
