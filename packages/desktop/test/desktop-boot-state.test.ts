import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	advanceBootPhase,
	getBootState,
	recordBootFailure,
	resetBootState,
} from "../src/desktop-boot-state.js";

// ---------------------------------------------------------------------------
// Reset state before each test to ensure isolation
// ---------------------------------------------------------------------------

beforeEach(() => {
	resetBootState();
});

afterEach(() => {
	resetBootState();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getBootState", () => {
	it("returns the initial boot state after reset", () => {
		const state = getBootState();
		expect(state.currentPhase).toBe("preflight");
		expect(state.lastSuccessfulPhase).toBeNull();
		expect(state.failureCode).toBeNull();
		expect(state.failureMessage).toBeNull();
		expect(state.startedAt).toBeTruthy();
		expect(state.phaseHistory).toHaveLength(1);
		expect(state.phaseHistory[0].phase).toBe("preflight");
	});
});

describe("advanceBootPhase", () => {
	it("records phase transitions correctly", () => {
		advanceBootPhase("create-window");
		const state = getBootState();
		expect(state.currentPhase).toBe("create-window");
		expect(state.lastSuccessfulPhase).toBe("preflight");
		expect(state.phaseHistory).toHaveLength(2);
		expect(state.phaseHistory[1].phase).toBe("create-window");
	});

	it("tracks multiple sequential phase transitions", () => {
		advanceBootPhase("create-window");
		advanceBootPhase("load-persisted-state");
		advanceBootPhase("initialize-connections");
		advanceBootPhase("ready");

		const state = getBootState();
		expect(state.currentPhase).toBe("ready");
		expect(state.lastSuccessfulPhase).toBe("initialize-connections");
		expect(state.phaseHistory).toHaveLength(5);
		expect(state.phaseHistory.map((e) => e.phase)).toEqual([
			"preflight",
			"create-window",
			"load-persisted-state",
			"initialize-connections",
			"ready",
		]);
	});

	it("records ISO timestamps in phase history", () => {
		advanceBootPhase("create-window");
		const state = getBootState();
		for (const entry of state.phaseHistory) {
			expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
		}
	});
});

describe("recordBootFailure", () => {
	it("transitions to 'failed' with the correct code and message", () => {
		advanceBootPhase("create-window");
		recordBootFailure("RUNTIME_CHILD_START_FAILED", "Child process exited with code 1");

		const state = getBootState();
		expect(state.currentPhase).toBe("failed");
		expect(state.failureCode).toBe("RUNTIME_CHILD_START_FAILED");
		expect(state.failureMessage).toBe("Child process exited with code 1");
	});

	it("preserves lastSuccessfulPhase as the phase before failure", () => {
		advanceBootPhase("create-window");
		advanceBootPhase("load-persisted-state");
		advanceBootPhase("initialize-connections");
		recordBootFailure("RUNTIME_CHILD_START_FAILED", "startup error");

		const state = getBootState();
		expect(state.lastSuccessfulPhase).toBe("initialize-connections");
	});

	it("appends 'failed' entry to phase history", () => {
		advanceBootPhase("create-window");
		recordBootFailure("PRELOAD_LOAD_FAILED", "preload error");

		const state = getBootState();
		expect(state.phaseHistory[state.phaseHistory.length - 1].phase).toBe("failed");
	});

	it("does not overwrite lastSuccessfulPhase if called multiple times", () => {
		advanceBootPhase("create-window");
		advanceBootPhase("initialize-connections");
		recordBootFailure("RUNTIME_CHILD_START_FAILED", "first error");
		recordBootFailure("UNKNOWN_STARTUP_FAILURE", "second error");

		const state = getBootState();
		// lastSuccessfulPhase should still be "initialize-connections" — not "failed"
		expect(state.lastSuccessfulPhase).toBe("initialize-connections");
		expect(state.failureCode).toBe("UNKNOWN_STARTUP_FAILURE");
		expect(state.failureMessage).toBe("second error");
	});
});

describe("resetBootState", () => {
	it("clears state for restart", () => {
		advanceBootPhase("create-window");
		advanceBootPhase("load-persisted-state");
		recordBootFailure("RUNTIME_CHILD_START_FAILED", "some error");

		resetBootState();

		const state = getBootState();
		expect(state.currentPhase).toBe("preflight");
		expect(state.lastSuccessfulPhase).toBeNull();
		expect(state.failureCode).toBeNull();
		expect(state.failureMessage).toBeNull();
		expect(state.phaseHistory).toHaveLength(1);
		expect(state.phaseHistory[0].phase).toBe("preflight");
	});

	it("produces a fresh startedAt timestamp", () => {
		const firstStart = getBootState().startedAt;
		resetBootState();
		const secondStart = getBootState().startedAt;

		// Both should be valid ISO timestamps
		expect(new Date(firstStart).toISOString()).toBe(firstStart);
		expect(new Date(secondStart).toISOString()).toBe(secondStart);
	});
});

describe("phase history", () => {
	it("is maintained across all operations", () => {
		// Initial state has preflight
		expect(getBootState().phaseHistory).toHaveLength(1);

		advanceBootPhase("create-window");
		expect(getBootState().phaseHistory).toHaveLength(2);

		advanceBootPhase("load-persisted-state");
		expect(getBootState().phaseHistory).toHaveLength(3);

		recordBootFailure("PREFLIGHT_FAILED", "failed");
		expect(getBootState().phaseHistory).toHaveLength(4);

		const phases = getBootState().phaseHistory.map((e) => e.phase);
		expect(phases).toEqual([
			"preflight",
			"create-window",
			"load-persisted-state",
			"failed",
		]);
	});
});

describe("lastSuccessfulPhase", () => {
	it("tracks the last non-failed phase", () => {
		expect(getBootState().lastSuccessfulPhase).toBeNull();

		advanceBootPhase("create-window");
		expect(getBootState().lastSuccessfulPhase).toBe("preflight");

		advanceBootPhase("load-persisted-state");
		expect(getBootState().lastSuccessfulPhase).toBe("create-window");

		advanceBootPhase("initialize-connections");
		expect(getBootState().lastSuccessfulPhase).toBe("load-persisted-state");

		advanceBootPhase("ready");
		expect(getBootState().lastSuccessfulPhase).toBe("initialize-connections");
	});

	it("is not overwritten when advancing from failed state", () => {
		advanceBootPhase("create-window");
		advanceBootPhase("initialize-connections");
		recordBootFailure("RUNTIME_CHILD_START_FAILED", "error");

		// Advance from failed — lastSuccessfulPhase should NOT become "failed"
		advanceBootPhase("ready");
		expect(getBootState().lastSuccessfulPhase).toBe("initialize-connections");
	});
});
