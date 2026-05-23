import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	powerSaveBlocker: {
		start: vi.fn(() => 1),
		stop: vi.fn(),
	},
}));

// EventEmitter-based stub — lets owned-mode tests emit "crashed" on the
// instance the orchestrator created internally.
const childManagers: FakeChildManager[] = [];

class FakeChildManager extends EventEmitter {
	constructor() {
		super();
		childManagers.push(this);
	}
	async start(): Promise<string> {
		return "http://127.0.0.1:3484";
	}
	async shutdown(): Promise<void> {}
	async dispose(): Promise<void> {}
}

vi.mock("../src/runtime-child.js", () => ({
	RuntimeChildManager: FakeChildManager,
}));

// Healthy mock-runtime response. RuntimeOrchestrator.checkHealth now reads
// the response body and requires the Kanban-specific `<title>Kanban</title>`
// element emitted by web-ui/index.html, so a bare `okResponse()` would fail
// the title grep even though it would pass the legacy `res.ok` check.
// Mirrored from the real index.html so attach-mode tests still resolve as
// healthy.
function okResponse(): Response {
	return {
		ok: true,
		text: async () => `<title>Kanban</title>`,
	} as unknown as Response;
}



const { RuntimeOrchestrator } = await import("../src/runtime-orchestrator.js");

describe("RuntimeOrchestrator attached-runtime crash detection", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// Module-level array; reset per-test so future assertions on
		// `childManagers.length` don't see leakage from earlier tests.
		childManagers.length = 0;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("emits 'crashed' when attached runtime fails probes past threshold", async () => {
		let healthy = true;
		const fetchImpl = vi.fn(async () => {
			return healthy
				? okResponse()
				: Promise.reject(new Error("ECONNREFUSED"));
		});

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			attachedProbeIntervalMs: 100,
			attachedProbeFailureThreshold: 3,
		});

		const crashed = vi.fn();
		orchestrator.on("crashed", crashed);

		// Initial probe succeeds (before attaching).
		await orchestrator.connect();
		expect(orchestrator.getUrl()).toBe("http://127.0.0.1:3484");
		expect(orchestrator.isOwned()).toBe(false);

		// Simulate the external runtime dying.
		healthy = false;

		// Advance time, flushing each probe's async work between ticks.
		for (let i = 0; i < 3; i += 1) {
			await vi.advanceTimersByTimeAsync(100);
		}

		expect(crashed).toHaveBeenCalledTimes(1);
		expect(orchestrator.getUrl()).toBeNull();
	});

	it("does not emit 'crashed' while attached runtime stays healthy", async () => {
		const fetchImpl = vi.fn(
			async () => okResponse(),
		) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 100,
			attachedProbeFailureThreshold: 2,
		});

		const crashed = vi.fn();
		orchestrator.on("crashed", crashed);

		await orchestrator.connect();

		for (let i = 0; i < 5; i += 1) {
			await vi.advanceTimersByTimeAsync(100);
		}

		expect(crashed).not.toHaveBeenCalled();
		expect(orchestrator.getUrl()).toBe("http://127.0.0.1:3484");
	});

	it("resets failure count after a transient probe failure recovers", async () => {
		let healthy = true;
		const fetchImpl = vi.fn(async () => {
			return healthy
				? okResponse()
				: Promise.reject(new Error("ECONNREFUSED"));
		}) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 100,
			attachedProbeFailureThreshold: 3,
		});

		const crashed = vi.fn();
		orchestrator.on("crashed", crashed);

		await orchestrator.connect();

		// Two failures, then recover, then two failures again — should NOT crash.
		healthy = false;
		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(100);
		healthy = true;
		await vi.advanceTimersByTimeAsync(100);
		healthy = false;
		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(100);

		expect(crashed).not.toHaveBeenCalled();
	});

	it("stops probing after dispose()", async () => {
		const fetchImpl = vi.fn(async () => okResponse());

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			attachedProbeIntervalMs: 100,
			attachedProbeFailureThreshold: 2,
		});

		await orchestrator.connect();
		const callsBeforeDispose = fetchImpl.mock.calls.length;

		await orchestrator.dispose();

		await vi.advanceTimersByTimeAsync(500);
		// No additional probes after dispose.
		expect(fetchImpl.mock.calls.length).toBe(callsBeforeDispose);
	});

	it("skips overlapping probe ticks when checkHealth hangs longer than the interval", async () => {
		// Hold each fetch open until manually resolved so we can simulate
		// a slow runtime that takes longer than the probe interval.
		const pendingResolvers: Array<(r: Response) => void> = [];
		const fetchImpl = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					pendingResolvers.push(resolve);
				}),
		) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 10_000,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 100,
			attachedProbeFailureThreshold: 5,
		});

		// Initial connect → first fetch resolves OK.
		const connectPromise = orchestrator.connect();
		await vi.advanceTimersByTimeAsync(0);
		pendingResolvers.shift()?.(okResponse());
		await connectPromise;

		const callsAfterConnect = (
			fetchImpl as unknown as ReturnType<typeof vi.fn>
		).mock.calls.length;

		// Advance through 5 probe intervals while the in-flight tick is
		// still pending. With the guard in place, only one new fetch is
		// issued — additional intervals see the in-flight flag and skip.
		for (let i = 0; i < 5; i += 1) {
			await vi.advanceTimersByTimeAsync(100);
		}

		const callsDuringHang = (fetchImpl as unknown as ReturnType<typeof vi.fn>)
			.mock.calls.length - callsAfterConnect;
		expect(callsDuringHang).toBe(1);

		// Resolve the hung tick; subsequent intervals should now issue
		// fresh probes (one per tick).
		pendingResolvers.shift()?.(okResponse());
		await vi.advanceTimersByTimeAsync(100);
		expect(
			(fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
		).toBeGreaterThan(callsAfterConnect + 1);

		// Drain any remaining hung promises so the test cleanup doesn't
		// leak unresolved fetches.
		while (pendingResolvers.length > 0) {
			pendingResolvers.shift()?.(okResponse());
		}
	});

	it("does not start probing when we own the child (post-restart)", async () => {
		const fetchImpl = vi.fn(async () => okResponse());

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			attachedProbeIntervalMs: 100,
			attachedProbeFailureThreshold: 2,
		});

		await orchestrator.connect();
		// After connect() we're in attached mode; a restart flips us to owned.
		await orchestrator.restart();
		expect(orchestrator.isOwned()).toBe(true);

		const crashed = vi.fn();
		orchestrator.on("crashed", crashed);
		const callsAfterRestart = fetchImpl.mock.calls.length;

		await vi.advanceTimersByTimeAsync(500);

		// Owned mode relies on child manager "crashed" events, not our
		// probe. So no extra fetch calls.
		expect(fetchImpl.mock.calls.length).toBe(callsAfterRestart);
		expect(crashed).not.toHaveBeenCalled();
	});
});

describe("RuntimeOrchestrator post-crash recovery probe", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		childManagers.length = 0;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("auto-reattaches when a runtime returns at the last-known origin", async () => {
		let healthy = true;
		const fetchImpl = vi.fn(async () => {
			return healthy
				? okResponse()
				: Promise.reject(new Error("ECONNREFUSED"));
		}) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 100,
			attachedProbeFailureThreshold: 2,
			recoveryProbeIntervalMs: 200,
		});

		const crashed = vi.fn();
		const urlChanges: Array<string | null> = [];
		orchestrator.on("crashed", crashed);
		orchestrator.on("url-changed", (url) => urlChanges.push(url));

		// Connect, then simulate the external runtime dying → crash path.
		await orchestrator.connect();
		healthy = false;
		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(100);
		expect(crashed).toHaveBeenCalledTimes(1);
		expect(orchestrator.getUrl()).toBeNull();

		// While on the disconnected screen, the recovery probe is polling
		// the last-known origin. Simulate the user running `kanban` in a
		// terminal — runtime returns on the same origin.
		healthy = true;

		// Wait one recovery interval for the probe to notice.
		await vi.advanceTimersByTimeAsync(200);

		// Orchestrator should have auto-reattached without a second crash.
		expect(orchestrator.getUrl()).toBe("http://127.0.0.1:3484");
		expect(orchestrator.isOwned()).toBe(false);
		expect(crashed).toHaveBeenCalledTimes(1);
		// The shell's url-changed listener would now reload every window
		// away from disconnected.html back to the runtime.
		expect(urlChanges).toEqual([
			"http://127.0.0.1:3484",
			null,
			"http://127.0.0.1:3484",
		]);
	});

	it("keeps polling silently while the runtime stays down", async () => {
		let healthy = true;
		const fetchImpl = vi.fn(async () => {
			return healthy
				? okResponse()
				: Promise.reject(new Error("ECONNREFUSED"));
		}) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 100,
			attachedProbeFailureThreshold: 2,
			recoveryProbeIntervalMs: 200,
		});

		const crashed = vi.fn();
		orchestrator.on("crashed", crashed);

		await orchestrator.connect();
		healthy = false;
		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(100);
		expect(crashed).toHaveBeenCalledTimes(1);

		// Runtime never comes back. Recovery probe should keep polling
		// without re-emitting "crashed" and without accidentally flipping
		// into a connected state.
		for (let i = 0; i < 5; i += 1) {
			await vi.advanceTimersByTimeAsync(200);
		}

		expect(crashed).toHaveBeenCalledTimes(1);
		expect(orchestrator.getUrl()).toBeNull();
	});

	it("stops the recovery probe when the user clicks Restart", async () => {
		let healthy = true;
		const fetchImpl = vi.fn(async () => {
			return healthy
				? okResponse()
				: Promise.reject(new Error("ECONNREFUSED"));
		}) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 100,
			attachedProbeFailureThreshold: 2,
			recoveryProbeIntervalMs: 200,
		});

		await orchestrator.connect();
		healthy = false;
		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(100);
		expect(orchestrator.getUrl()).toBeNull();

		// User clicks Restart while still down. The mocked child manager
		// returns a fixed URL from start(), so restart() flips us into
		// owned mode — recovery must stop.
		await orchestrator.restart();
		expect(orchestrator.isOwned()).toBe(true);

		const callsAfterRestart = (fetchImpl as unknown as ReturnType<typeof vi.fn>)
			.mock.calls.length;

		// Advance well past several recovery intervals; no more probes.
		await vi.advanceTimersByTimeAsync(1_000);

		expect(
			(fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
		).toBe(callsAfterRestart);
	});

	it("stops the recovery probe after dispose()", async () => {
		let healthy = true;
		const fetchImpl = vi.fn(async () => {
			return healthy
				? okResponse()
				: Promise.reject(new Error("ECONNREFUSED"));
		}) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 100,
			attachedProbeFailureThreshold: 2,
			recoveryProbeIntervalMs: 200,
		});

		await orchestrator.connect();
		healthy = false;
		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(100);

		const callsBeforeDispose = (
			fetchImpl as unknown as ReturnType<typeof vi.fn>
		).mock.calls.length;

		await orchestrator.dispose();

		await vi.advanceTimersByTimeAsync(1_000);

		expect(
			(fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
		).toBe(callsBeforeDispose);
	});

	it("clears URL when restart's spawn fails so the shell isn't left pointing at a dead origin", async () => {
		const fetchImpl = vi.fn(
			async () => okResponse(),
		) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		childManagers.length = 0;
		await orchestrator.connect();
		// Attached-mode on connect; restart flips to owned with the first
		// FakeChildManager instance. Arrange the second instance (created
		// inside restart's startOwnRuntime) to throw from start().
		await orchestrator.restart();
		expect(orchestrator.isOwned()).toBe(true);
		expect(orchestrator.getUrl()).toBe("http://127.0.0.1:3484");

		const failOnStart = vi
			.spyOn(FakeChildManager.prototype, "start")
			.mockRejectedValueOnce(new Error("port in use"));

		await expect(orchestrator.restart()).rejects.toThrow("port in use");

		// The failed restart must not leave a stale URL pointing at the
		// runtime we just killed.
		expect(orchestrator.getUrl()).toBeNull();
		expect(orchestrator.isOwned()).toBe(false);

		failOnStart.mockRestore();
	});

	it("clears URL when restart's spawn fails directly from attached mode", async () => {
		// Edge case to the previous test: user is attached to an external
		// runtime (no owned manager) and triggers restart from the renderer.
		// The shutdown branch is skipped, so the URL clear must happen
		// unconditionally — otherwise getUrl() would keep returning the old
		// attached origin after the spawn throws.
		const fetchImpl = vi.fn(
			async () => okResponse(),
		) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		childManagers.length = 0;
		await orchestrator.connect();
		expect(orchestrator.isOwned()).toBe(false);
		expect(orchestrator.getUrl()).toBe("http://127.0.0.1:3484");

		const failOnStart = vi
			.spyOn(FakeChildManager.prototype, "start")
			.mockRejectedValueOnce(new Error("port in use"));

		await expect(orchestrator.restart()).rejects.toThrow("port in use");

		expect(orchestrator.getUrl()).toBeNull();
		expect(orchestrator.isOwned()).toBe(false);

		failOnStart.mockRestore();
	});

	it("starts recovery probe on owned-child crash event", async () => {
		const fetchImpl = vi.fn(
			async () => okResponse(),
		) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 200,
		});

		const crashed = vi.fn();
		orchestrator.on("crashed", crashed);

		childManagers.length = 0;
		await orchestrator.connect();
		// Attached-mode on connect; restart to flip into owned mode.
		await orchestrator.restart();
		expect(orchestrator.isOwned()).toBe(true);
		const ownedManager = childManagers.at(-1);
		expect(ownedManager).toBeDefined();

		// Simulate the child process crashing.
		ownedManager?.emit("crashed", 1, null, "segfault\n");

		expect(crashed).toHaveBeenCalledTimes(1);
		expect(orchestrator.getUrl()).toBeNull();

		// Recovery probe should be polling the last-known origin.
		await vi.advanceTimersByTimeAsync(200);
		expect(orchestrator.getUrl()).toBe("http://127.0.0.1:3484");
		expect(orchestrator.isOwned()).toBe(false);
		expect(crashed).toHaveBeenCalledTimes(1);
	});

	it("invalidates an in-flight recovery probe when restart() fires mid-fetch", async () => {
		// Regression test for the lifecycle race where `restart()` calls
		// `stopRecoveryProbe()` (clearing the timer) but a tick that has
		// already advanced past the timer-fire and is awaiting
		// `checkHealth()` keeps running. During `restart()`, `this.url` is
		// intentionally null until `startOwnRuntime()` resolves, so the
		// existing post-await `url !== null` guard inside the tick can't
		// distinguish "still crashed" from "mid-restart". A late-arriving
		// healthy resolution would `setUrl(oldOrigin, false)` and — if the
		// spawn then fails — leave the orchestrator stuck attached to the
		// dead old origin even though restart rejected.
		//
		// The fix is the per-probe generation token; this test holds a
		// recovery `checkHealth` open across a failing restart and asserts
		// the orchestrator settles disconnected, not stale-attached.
		const pendingResolvers: Array<(r: Response) => void> = [];
		let mode: "ok" | "fail" | "hold" = "ok";

		const fetchImpl = vi.fn(async () => {
			if (mode === "fail") throw new Error("ECONNREFUSED");
			if (mode === "hold") {
				return new Promise<Response>((resolve) => {
					pendingResolvers.push(resolve);
				});
			}
			return okResponse();
		}) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 10_000,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 100,
			attachedProbeFailureThreshold: 2,
			recoveryProbeIntervalMs: 200,
		});

		childManagers.length = 0;

		// Connect → attached mode at the default origin.
		await orchestrator.connect();
		expect(orchestrator.getUrl()).toBe("http://127.0.0.1:3484");

		// Crash via attached probe.
		mode = "fail";
		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(100);
		expect(orchestrator.getUrl()).toBeNull();

		// Recovery probe ticks; we hold its checkHealth open so the tick
		// is suspended awaiting fetch.
		mode = "hold";
		await vi.advanceTimersByTimeAsync(200);
		expect(pendingResolvers.length).toBe(1);

		// User clicks Restart while the recovery tick is mid-flight, and
		// the spawn fails (port in use, missing CLI shim, etc.). Without
		// invalidation, the recovery tick's late `setUrl(oldOrigin, false)`
		// would re-attach behind restart's back.
		const failOnStart = vi
			.spyOn(FakeChildManager.prototype, "start")
			.mockRejectedValueOnce(new Error("port in use"));

		const urlChanges: Array<string | null> = [];
		orchestrator.on("url-changed", (u) => urlChanges.push(u));

		const restartPromise = orchestrator.restart();
		// Resolve the held recovery fetch healthy, simulating the worst-case
		// timing: stale tick reports the old origin alive while restart is
		// in its window of `url === null`.
		pendingResolvers.shift()?.(okResponse());
		await expect(restartPromise).rejects.toThrow("port in use");

		expect(orchestrator.getUrl()).toBeNull();
		expect(orchestrator.isOwned()).toBe(false);
		// No transient flash to the old origin during the restart window —
		// the only `url-changed` payload should be `null` (the setUrl(null)
		// hoist inside restart).
		expect(urlChanges.filter((u) => u !== null)).toEqual([]);

		failOnStart.mockRestore();
	});

	it("ignores additional crashed/error events after handleCrash detaches the dead manager", async () => {
		// `handleCrash` removes listeners on the dead manager before
		// nulling the reference. Without that, a child cleanup path
		// emitting another `crashed` (or `error`) event would re-enter
		// `handleCrash`, double-counting the failure and resetting the
		// recovery probe mid-flight.
		const fetchImpl = vi.fn(
			async () => okResponse(),
		) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 200,
		});

		const crashed = vi.fn();
		orchestrator.on("crashed", crashed);

		childManagers.length = 0;
		await orchestrator.connect();
		await orchestrator.restart();
		expect(orchestrator.isOwned()).toBe(true);
		const ownedManager = childManagers.at(-1);
		expect(ownedManager).toBeDefined();

		// First crash → handleCrash runs once.
		ownedManager?.emit("crashed", 1, null, "first\n");
		expect(crashed).toHaveBeenCalledTimes(1);

		// Subsequent events on the same (now-detached) manager must be
		// ignored. Without the detach in handleCrash, both would re-enter
		// and double-count the failure. We attach a sink before emitting
		// `error` because Node's EventEmitter throws "Unhandled error" if
		// no listener exists — that throw itself proves the orchestrator's
		// listener is gone, but we want to also assert no re-entry into
		// handleCrash beyond it.
		ownedManager?.on("error", () => {});
		ownedManager?.emit("crashed", 1, null, "second\n");
		ownedManager?.emit("error", "post-cleanup error");

		expect(crashed).toHaveBeenCalledTimes(1);
	});

	it("clears state on shutdown so getUrl()/isOwned() reflect disconnected", async () => {
		// Regression test for the public-API postcondition: after
		// `await shutdown()` the orchestrator must look disconnected, not
		// stuck pointing at the dead origin we just killed. Otherwise a
		// later `setUrl(sameOrigin, true)` would skip the `url-changed`
		// emit because the no-op-transition guard sees no change, and
		// any code path that does `if (!this.manager)` (like
		// `startOwnRuntime`) would reuse the dead manager.
		const fetchImpl = vi.fn(
			async () => okResponse(),
		) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		childManagers.length = 0;
		await orchestrator.connect();
		// connect() lands in attached mode; restart() flips to owned via
		// the FakeChildManager's fixed-URL start().
		await orchestrator.restart();
		expect(orchestrator.isOwned()).toBe(true);
		expect(orchestrator.getUrl()).toBe("http://127.0.0.1:3484");

		const urlChanges: Array<string | null> = [];
		orchestrator.on("url-changed", (u) => urlChanges.push(u));

		await orchestrator.shutdown();

		expect(orchestrator.getUrl()).toBeNull();
		expect(orchestrator.isOwned()).toBe(false);
		// Exactly one transition: owned-origin → null.
		expect(urlChanges).toEqual([null]);

		// Sanity: probes don't fire after shutdown.
		const callsAfterShutdown = (
			fetchImpl as unknown as ReturnType<typeof vi.fn>
		).mock.calls.length;
		await vi.advanceTimersByTimeAsync(1_000);
		expect(
			(fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
		).toBe(callsAfterShutdown);
	});

	it("clears URL before manager.shutdown() so getUrl() doesn't return the dead origin mid-restart", async () => {
		// Regression test for the mid-restart stale-URL window:
		// `restart()` must clear the URL *before* awaiting
		// `manager.shutdown()`, not after. Otherwise during the multi-second
		// graceful shutdown of the child, `getUrl()` keeps returning the
		// origin we're about to kill — anything that opens a window or
		// reloads during that window would point at a dying runtime.
		const fetchImpl = vi.fn(
			async () => okResponse(),
		) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		await orchestrator.connect();
		await orchestrator.restart();
		expect(orchestrator.isOwned()).toBe(true);
		expect(orchestrator.getUrl()).toBe("http://127.0.0.1:3484");

		// Hold the next manager.shutdown() open so we can observe the
		// orchestrator's state mid-await. `!` because TS can't track the
		// assignment through the Promise executor closure.
		let releaseShutdown!: () => void;
		const shutdownHeld = new Promise<void>((resolve) => {
			releaseShutdown = resolve;
		});
		const shutdownSpy = vi
			.spyOn(FakeChildManager.prototype, "shutdown")
			.mockImplementationOnce(() => shutdownHeld);

		// Kick off restart but don't await yet.
		const restartPromise = orchestrator.restart();
		// Yield enough microtasks for restart to enter the shutdown await.
		await vi.advanceTimersByTimeAsync(0);
		await Promise.resolve();
		await Promise.resolve();

		// The fix: URL must already be null even though shutdown hasn't
		// resolved. Without the hoist, getUrl() would still report the
		// pre-restart origin here.
		expect(orchestrator.getUrl()).toBeNull();
		expect(orchestrator.isOwned()).toBe(false);

		// Release shutdown; restart proceeds to startOwnRuntime which
		// flips us into owned mode at the same default origin.
		releaseShutdown();
		await restartPromise;

		expect(orchestrator.getUrl()).toBe("http://127.0.0.1:3484");
		expect(orchestrator.isOwned()).toBe(true);
		shutdownSpy.mockRestore();
	});

	it("clears state on dispose so getUrl()/isOwned() match shutdown semantics", async () => {
		// Symmetric to the shutdown postcondition test — `dispose()` is
		// the other terminal lifecycle method and consumers should not
		// have to remember which one clears state.
		const fetchImpl = vi.fn(
			async () => okResponse(),
		) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		childManagers.length = 0;
		await orchestrator.connect();
		await orchestrator.restart();
		expect(orchestrator.isOwned()).toBe(true);

		const urlChanges: Array<string | null> = [];
		orchestrator.on("url-changed", (u) => urlChanges.push(u));

		await orchestrator.dispose();

		expect(orchestrator.getUrl()).toBeNull();
		expect(orchestrator.isOwned()).toBe(false);
		expect(urlChanges).toEqual([null]);
	});

	it("dispose() during attached-mode connect() health check skips setUrl and doesn't spawn", async () => {
		// Regression: connect() awaits checkHealth(); the continuation
		// (setUrl on success or startOwnRuntime on failure) must not run
		// if a teardown landed during the await — otherwise a disposed
		// orchestrator ends up pointing at the attached origin with the
		// attached probe ticking in the background.

		const pendingResolvers: Array<(r: Response) => void> = [];
		const fetchImpl = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					pendingResolvers.push(resolve);
				}),
		) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 10_000,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 100,
			recoveryProbeIntervalMs: 200,
		});

		const urlChanges: Array<string | null> = [];
		orchestrator.on("url-changed", (u) => urlChanges.push(u));

		// Start connect; the health-check fetch is now suspended.
		const connectPromise = orchestrator.connect();
		await vi.advanceTimersByTimeAsync(0);
		expect(pendingResolvers.length).toBe(1);

		// dispose() lands while checkHealth is suspended. With drain it
		// will await connectPromise; we resolve the held fetch so the
		// continuation runs and bails on the flag.
		const disposePromise = orchestrator.dispose();
		// Resolve the held health-check as healthy — worst case for the
		// race: continuation would `setUrl(origin, false)` without the
		// guard.
		pendingResolvers.shift()?.(okResponse());
		await connectPromise;
		await disposePromise;

		expect(orchestrator.getUrl()).toBeNull();
		expect(orchestrator.isOwned()).toBe(false);
		// No URL-changed emit ever fired (no transient flash to the
		// attached origin and back to null).
		expect(urlChanges).toEqual([]);
		// And no children were spawned.
		expect(childManagers.length).toBe(0);
	});

	it("shutdown() during connect()'s startOwnRuntime() does not leak an orphan child (the before-quit-during-startup case)", async () => {
		// Behavioral coverage for the main.ts before-quit P1 fix: a
		// shutdown() landing while manager.start() is suspended must
		// drain the connect promise and let startOwnRuntime's
		// orphan-cleanup branch kill the spawn. Sibling `dispose()`
		// test below covers the same race via the other terminal entry
		// point.
		const fetchImpl = vi.fn(

			async () => Promise.reject(new Error("ECONNREFUSED")),
		) as unknown as typeof fetch;

		// Hold manager.start() so shutdown() can land mid-spawn.
		let releaseStart!: (url: string) => void;
		const startHeld = new Promise<string>((resolve) => {
			releaseStart = resolve;
		});
		const startSpy = vi
			.spyOn(FakeChildManager.prototype, "start")
			.mockImplementationOnce(() => startHeld);
		const shutdownSpy = vi.spyOn(FakeChildManager.prototype, "shutdown");

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		const urlChanges: Array<string | null> = [];
		orchestrator.on("url-changed", (u) => urlChanges.push(u));

		// connect() → checkHealth rejects → startOwnRuntime → suspends
		// inside manager.start() awaiting the held promise.
		const connectPromise = orchestrator.connect();
		// Yield enough microtasks for startOwnRuntime to enter the
		// `await manager.start(...)` await.
		await vi.advanceTimersByTimeAsync(0);
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(childManagers.length).toBe(1);

		// Now simulate `before-quit` calling `shutdown()` during the
		// startup spawn window. shutdown() will:
		//   1. set terminated=true
		//   2. await connectPromise (held)
		//   3. tear down (which finds manager already null'd or about
		//      to be null'd by the orphan-cleanup branch)
		const shutdownPromise = orchestrator.shutdown();
		await Promise.resolve();

		// Release the suspended spawn — startOwnRuntime resumes, sees
		// terminated=true, enters its orphan-cleanup branch, and shuts
		// the just-spawned child down directly.
		releaseStart("http://127.0.0.1:3484");
		await connectPromise;
		await shutdownPromise;

		// The just-spawned orphan was cleaned up — manager.shutdown
		// was called once. Without the unconditional shutdown() in
		// before-quit, the drain wouldn't run and this would never fire.
		expect(shutdownSpy).toHaveBeenCalledTimes(1);
		expect(orchestrator.getUrl()).toBeNull();
		expect(orchestrator.isOwned()).toBe(false);
		// No URL-changed for the spawned-then-killed origin (no flash).
		expect(urlChanges).toEqual([]);
		// And no second child was constructed.
		expect(childManagers.length).toBe(1);

		startSpy.mockRestore();
		shutdownSpy.mockRestore();
	});

	it("dispose() during connect()'s startOwnRuntime() does not leak an orphan child", async () => {

		// Regression: connect() falls through to startOwnRuntime() when
		// checkHealth fails; if dispose() runs while manager.start() is
		// suspended, the spawn must either be skipped (if dispose lands
		// before start begins) or the just-spawned child must be cleaned
		// up directly (if start completes after dispose began). Without
		// this, a slow startup + user quit leaves an orphan runtime
		// process running with no orchestrator owner.

		const fetchImpl = vi.fn(
			async () => Promise.reject(new Error("ECONNREFUSED")),
		) as unknown as typeof fetch;

		// Hold manager.start() open so we can fire dispose() mid-spawn.
		let releaseStart!: (url: string) => void;
		const startHeld = new Promise<string>((resolve) => {
			releaseStart = resolve;
		});
		const startSpy = vi
			.spyOn(FakeChildManager.prototype, "start")
			.mockImplementationOnce(() => startHeld);
		const shutdownSpy = vi.spyOn(FakeChildManager.prototype, "shutdown");

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		const urlChanges: Array<string | null> = [];
		orchestrator.on("url-changed", (u) => urlChanges.push(u));

		// Connect: checkHealth rejects → falls through to startOwnRuntime.
		const connectPromise = orchestrator.connect();
		// Yield enough microtasks for the IIFE to enter
		// startOwnRuntime's `await manager.start(...)`.
		await vi.advanceTimersByTimeAsync(0);
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(childManagers.length).toBe(1);

		// dispose() lands mid-spawn. It awaits connectPromise; we then
		// release the spawn so the suspended IIFE resumes.
		const disposePromise = orchestrator.dispose();
		await Promise.resolve();
		releaseStart("http://127.0.0.1:3484");
		await connectPromise;
		await disposePromise;

		// The just-spawned child was cleaned up directly inside
		// startOwnRuntime (not via the dispose path's manager.dispose,
		// because dispose's drain unblocks *after* startOwnRuntime sees
		// terminated=true and runs its own shutdown). Either way the
		// orphan must have been shut down once.
		expect(shutdownSpy).toHaveBeenCalledTimes(1);
		expect(orchestrator.getUrl()).toBeNull();
		expect(orchestrator.isOwned()).toBe(false);
		// No URL-changed for the spawned-then-killed origin.
		expect(urlChanges).toEqual([]);
		// No second child created.
		expect(childManagers.length).toBe(1);

		startSpy.mockRestore();
		shutdownSpy.mockRestore();
	});

	it("shutdown() during restart() drains restartPromise and prevents post-teardown spawn", async () => {
		// Regression: shutdown() previously didn't await restartPromise,
		// so restart()'s continuation could call startOwnRuntime() *after*
		// shutdown ran teardown. With the drain + `terminated` flag, the
		// restart IIFE bails post-await without spawning a new child, and
		// shutdown's own teardown finds no dangling manager.

		const fetchImpl = vi.fn(
			async () => okResponse(),
		) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		// Connect + restart to land in owned mode with a real (mocked)
		// child manager.
		await orchestrator.connect();
		await orchestrator.restart();
		expect(orchestrator.isOwned()).toBe(true);
		const childCountAfterRestart = childManagers.length;

		// Hold the next manager.shutdown() open, then trigger restart()
		// (which awaits manager.shutdown), then trigger shutdown() while
		// restart is suspended in that await.
		let releaseShutdown!: () => void;
		const shutdownHeld = new Promise<void>((resolve) => {
			releaseShutdown = resolve;
		});
		const shutdownSpy = vi
			.spyOn(FakeChildManager.prototype, "shutdown")
			.mockImplementationOnce(() => shutdownHeld);

		const restartPromise = orchestrator.restart();
		// Yield microtasks until restart enters its manager.shutdown await.
		await vi.advanceTimersByTimeAsync(0);
		await Promise.resolve();
		await Promise.resolve();

		// shutdown() lands while restart is suspended. It will:
		//   1. set terminated=true
		//   2. await restartPromise (currently held)
		//   3. tear down (which finds manager already null'd by restart)
		const shutdownPromise = orchestrator.shutdown();
		await Promise.resolve();
		await Promise.resolve();

		// Release the held manager.shutdown — restart resumes, sees
		// terminated, bails before startOwnRuntime. No new manager spawned.
		releaseShutdown();
		await restartPromise;
		await shutdownPromise;

		expect(orchestrator.getUrl()).toBeNull();
		expect(orchestrator.isOwned()).toBe(false);
		// Critical: no second child spawned by restart's continuation.
		expect(childManagers.length).toBe(childCountAfterRestart);
		shutdownSpy.mockRestore();
	});

	it("idempotent shutdown(): second call after drain is a no-op", async () => {
		// Belt-and-suspenders for the `terminated` latch — a second
		// shutdown/dispose call must not re-run any teardown side effects.
		const fetchImpl = vi.fn(
			async () => okResponse(),
		) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		await orchestrator.connect();
		await orchestrator.restart();

		const ownedManager = childManagers.at(-1);
		const managerShutdownSpy = vi.spyOn(ownedManager!, "shutdown");

		await orchestrator.shutdown();
		expect(managerShutdownSpy).toHaveBeenCalledTimes(1);

		await orchestrator.shutdown();
		await orchestrator.dispose();
		// Only the first shutdown actually tore down the child.
		expect(managerShutdownSpy).toHaveBeenCalledTimes(1);
		expect(orchestrator.getUrl()).toBeNull();
	});

	it("does not start recovery when recoveryProbeIntervalMs is 0", async () => {
		let healthy = true;
		const fetchImpl = vi.fn(async () => {
			return healthy
				? okResponse()
				: Promise.reject(new Error("ECONNREFUSED"));
		}) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 100,
			attachedProbeFailureThreshold: 2,
			recoveryProbeIntervalMs: 0,
		});

		await orchestrator.connect();
		healthy = false;
		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(100);
		expect(orchestrator.getUrl()).toBeNull();

		const callsAfterCrash = (
			fetchImpl as unknown as ReturnType<typeof vi.fn>
		).mock.calls.length;

		// Bring the runtime back — with recovery disabled, nothing watches.
		healthy = true;
		await vi.advanceTimersByTimeAsync(1_000);

		expect(
			(fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
		).toBe(callsAfterCrash);
		expect(orchestrator.getUrl()).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Late-arriving crash event during/after dispose() — manager teardown can
// race with `crashed` events fired from the child cleanup path. The
// orchestrator must not re-arm recovery or re-emit `crashed` on a torn-down
// instance, and must not throw on a manager reference that became null
// mid-await inside dispose().
// ---------------------------------------------------------------------------

describe("RuntimeOrchestrator dispose() vs late crash events", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		childManagers.length = 0;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("ignores 'crashed' events that fire after dispose() has begun", async () => {
		// Setup: spawn an owned runtime so we have a manager whose
		// `crashed` event will route into `handleCrash`.
		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl: vi.fn(async () =>
				Promise.reject(new Error("ECONNREFUSED")),
			) as unknown as typeof fetch,
			recoveryProbeIntervalMs: 100,
		});

		await orchestrator.connect();
		expect(orchestrator.isOwned()).toBe(true);
		const manager = childManagers[0];

		// Wire a `crashed` listener so we can detect re-emission. Then
		// kick off dispose — but stash a reference to the manager and
		// emit `crashed` AFTER `terminated` flipped but BEFORE the
		// teardown finished. The cleanest way to model that here is to
		// emit immediately after kicking off `dispose()` synchronously
		// (the `if (this.terminated) return` early-bail at the top of
		// `dispose()` won't fire because we haven't called dispose yet
		// for the second time — `terminated` is set inside dispose
		// itself, after the early-bail check).
		const crashedSpy = vi.fn();
		orchestrator.on("crashed", crashedSpy);

		// Make manager.dispose() take a tick so we have a window where
		// `terminated` is true but the manager is still attached.
		manager.dispose = async (): Promise<void> => {
			// Now `terminated` is true. Fire a late crash from the same
			// manager — this models the child's exit handler firing
			// during graceful shutdown.
			manager.emit("crashed", 0, null, "");
		};

		await orchestrator.dispose();

		// Recovery probe must NOT be running — advancing time should
		// produce no probe activity, and getUrl() must remain null.
		expect(orchestrator.getUrl()).toBeNull();
		expect(crashedSpy).not.toHaveBeenCalled();

		// Sanity: any leaked recovery probe would call fetch on each
		// tick. Advance well past the configured interval.
		await vi.advanceTimersByTimeAsync(500);
		expect(crashedSpy).not.toHaveBeenCalled();
	});

	it("does not throw when manager becomes null mid-await inside dispose()", async () => {
		// Models the race where the manager's `crashed` event fires
		// during `manager.dispose()`, re-entering `handleCrash` which
		// nulls `this.manager`. Without the local capture, the
		// listener-removal calls on the now-null reference would throw.
		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl: vi.fn(async () =>
				Promise.reject(new Error("ECONNREFUSED")),
			) as unknown as typeof fetch,
			recoveryProbeIntervalMs: 0,
		});

		await orchestrator.connect();
		const manager = childManagers[0];

		// During dispose's `await manager.dispose()`, fire a crashed
		// event — `handleCrash` will null `this.manager` from under us.
		manager.dispose = async (): Promise<void> => {
			manager.emit("crashed", 0, null, "");
			// Yield once so the synchronous re-entry into `handleCrash`
			// completes before we resolve.
			await Promise.resolve();
		};

		// Must not throw. With the bug, this would surface as an
		// unhandled rejection: "Cannot read properties of null
		// (reading 'removeAllListeners')".
		await expect(orchestrator.dispose()).resolves.toBeUndefined();
		expect(orchestrator.getUrl()).toBeNull();
	});

	it("orphan-cleanup branch in startOwnRuntime survives crash mid-await on manager.shutdown()", async () => {
		// Models the third site of the same race pattern (sister to the
		// `dispose()` and `shutdown()` cases above): `dispose()` lands
		// while `manager.start()` is still spawning. When `start()`
		// resolves, `startOwnRuntime()` sees `terminated === true` and
		// enters the orphan-cleanup branch, which awaits
		// `manager.shutdown()` and then calls `removeAllListeners` on
		// the manager. If `handleCrash()` fires synchronously during
		// that shutdown await — nulling `this.manager` — the post-await
		// listener-removal would throw on the now-null reference. The
		// throw is silently swallowed by the IIFE's outer
		// `.catch(() => {})` in the connect/restart drain, so the bug
		// doesn't crash the app — but the listener-removal never runs,
		// leaving the orphan-cleanup branch silently incomplete.
		//
		// Mutation-verifying this is subtle because `handleCrash` *also*
		// calls `removeAllListeners` on the same manager before nulling
		// the reference, so listener counts hit 0 either way. The test
		// distinguishes the two paths by collecting unhandled rejections
		// from the connect IIFE's `.catch(() => {})` boundary: with the
		// bug, the post-await `this.manager.removeAllListeners(...)`
		// throws TypeError; the catch in the IIFE swallows it but it
		// shows up if you instrument before the catch. We instrument by
		// rejecting from `manager.shutdown` itself and watching the
		// orchestrator's downstream behavior — and additionally by
		// counting how many distinct call sites invoke
		// `removeAllListeners` on the doomed manager.
		const fetchImpl = vi.fn(
			async () => Promise.reject(new Error("ECONNREFUSED")),
		) as unknown as typeof fetch;

		// Hold manager.start() so dispose() can land mid-spawn.
		let releaseStart!: (url: string) => void;
		const startHeld = new Promise<string>((resolve) => {
			releaseStart = resolve;
		});
		const startSpy = vi
			.spyOn(FakeChildManager.prototype, "start")
			.mockImplementationOnce(() => startHeld);

		// shutdown() — invoked by the orphan-cleanup branch — fires a
		// crashed event mid-await. handleCrash() will set
		// `this.manager = null` synchronously, modeling the exact race
		// the local-capture fix is meant to handle.
		let crashedDuringShutdown = false;
		const shutdownSpy = vi
			.spyOn(FakeChildManager.prototype, "shutdown")
			.mockImplementationOnce(async function (
				this: InstanceType<typeof FakeChildManager>,
			) {
				this.emit("crashed", 0, null, "");
				crashedDuringShutdown = true;
				await Promise.resolve();
			});

		// Spy on the EventEmitter's `removeAllListeners` so we can
		// distinguish the buggy and fixed paths. With the fix:
		//   handleCrash → 2 calls ("crashed", "error")
		//   orphan cleanup (on captured local) → 2 calls ("crashed", "error")
		//   total: 4 invocations
		// Without the fix:
		//   handleCrash → 2 calls
		//   orphan cleanup → throws on the FIRST `this.manager.removeAllListeners(...)`
		//                    because `this.manager` is null → 0 successful calls
		//   total: 2 invocations
		// The exact 4-vs-2 count makes this a true mutation-killing assertion.
		const removeAllListenersSpy = vi.spyOn(
			FakeChildManager.prototype,
			"removeAllListeners",
		);

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		const connectPromise = orchestrator.connect();
		// Let connect() reach `await manager.start(...)`.
		await vi.advanceTimersByTimeAsync(0);
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(childManagers.length).toBe(1);
		const manager = childManagers[0];

		// Reset the spy AFTER setup — there may be incidental
		// removeAllListeners calls during construction we don't care
		// about. Now we measure only the teardown calls.
		removeAllListenersSpy.mockClear();

		// Dispose lands mid-spawn → drains connect → start resolves →
		// startOwnRuntime sees terminated=true → enters orphan-cleanup
		// → awaits manager.shutdown() (which emits `crashed`) →
		// post-await listener removal must NOT throw on the
		// now-`this.manager === null` field.
		const disposePromise = orchestrator.dispose();
		await Promise.resolve();
		releaseStart("http://127.0.0.1:3484");
		await connectPromise;
		await expect(disposePromise).resolves.toBeUndefined();

		// Sanity: the race window was actually hit, not bypassed by
		// some test-ordering accident.
		expect(crashedDuringShutdown).toBe(true);

		// Mutation-killing assertion: orphan cleanup must invoke
		// `removeAllListeners` for both events on the captured manager
		// local *after* handleCrash already cleaned up. Total of 4
		// invocations across the doomed manager (2 from handleCrash, 2
		// from orphan cleanup). Without the local-capture fix, the
		// orphan cleanup's first `this.manager.removeAllListeners(...)`
		// throws before either event-name call lands, dropping the
		// total to 2.
		const callsOnDoomedManager = removeAllListenersSpy.mock.calls.filter(
			(_args, idx) => removeAllListenersSpy.mock.instances[idx] === manager,
		);
		expect(callsOnDoomedManager.length).toBe(4);
		const eventNames = callsOnDoomedManager.map((c) => c[0]).sort();
		expect(eventNames).toEqual(["crashed", "crashed", "error", "error"]);

		// Final state: orchestrator is fully torn down.
		expect(orchestrator.getUrl()).toBeNull();
		expect(orchestrator.isOwned()).toBe(false);

		removeAllListenersSpy.mockRestore();
		startSpy.mockRestore();
		shutdownSpy.mockRestore();
	});

	// -----------------------------------------------------------------
	// CLI shim path: cache + upfront validation. The resolved path is
	// cached after first lookup and validated up front so a missing shim
	// surfaces with an actionable error instead of an opaque ENOENT from
	// `child_process.spawn`.
	// -----------------------------------------------------------------


	it("resolveCliShimPath is called once and cached across multiple child spawns", async () => {
		const fetchImpl = vi.fn(async () => ({ ok: false }) as Response);
		const resolveCliShimPath = vi.fn(() => process.execPath);
		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		// First spawn — initial resolve + validate.
		await orchestrator.connect();
		expect(resolveCliShimPath).toHaveBeenCalledTimes(1);

		// Second spawn via restart — should hit the cache, not re-resolve.
		// (`restart()` tears down the manager and calls `startOwnRuntime()`
		// again, which calls `createManager()` → `getValidatedShimPath()`.)
		await orchestrator.restart();
		expect(resolveCliShimPath).toHaveBeenCalledTimes(1);

		// Third spawn — still cached.
		await orchestrator.restart();
		expect(resolveCliShimPath).toHaveBeenCalledTimes(1);

		await orchestrator.shutdown();
	});

	it("throws an actionable error when the resolved shim path does not exist", async () => {
		const fetchImpl = vi.fn(async () => ({ ok: false }) as Response);
		const missingPath = "/this/path/intentionally/does/not/exist/kanban";
		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => missingPath,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		// `connect()` falls through to `startOwnRuntime()` which calls
		// `createManager()` → `getValidatedShimPath()` and should throw
		// before any child is spawned.
		await expect(orchestrator.connect()).rejects.toThrow(
			/CLI shim not found at .*intentionally.*does.*not.*exist/,
		);
		// And the error is *actionable* — it names the remediation path.
		await expect(orchestrator.connect()).rejects.toThrow(
			/npm run stage:cli/,
		);
		// No child was spawned (no FakeChildManager was constructed since
		// the `new RuntimeChildManager(...)` line is past the validation).
		expect(childManagers.length).toBe(0);

		await orchestrator.dispose();
	});

	// -----------------------------------------------------------------
	// setUrl: emit `url-changed` only on actual URL transitions.
	// Contract-documenting test: locks the expected emission count
	// across connect → restart → shutdown so any future hot-handover
	// path (owned → attached at the same origin without an intermediate
	// null) will fire `url-changed` and break this count, forcing a
	// conscious decision about whether the renderer reload is wanted.
	// -----------------------------------------------------------------


	// handleCrash must arm recovery BEFORE setUrl(null)'s synchronous
	// emit, so a re-entrant restart() from a url-changed listener can
	// stop the just-armed probe instead of racing with handleCrash to
	// re-arm it after restart already cleaned up.
	it("arms recovery before the synchronous url-changed(null) emit so a re-entrant restart can stop it", async () => {
		let healthy = true;
		const fetchImpl = vi.fn(async () => {
			return healthy
				? okResponse()
				: Promise.reject(new Error("ECONNREFUSED"));
		});

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			attachedProbeIntervalMs: 100,
			attachedProbeFailureThreshold: 2,
			recoveryProbeIntervalMs: 50,
		});

		childManagers.length = 0;
		await orchestrator.connect();

		// Hold the next manager.start() so the spawn window stays open
		// long enough for any leaked recovery probe (bug case) to tick.
		let releaseStart!: (url: string) => void;
		const startHeld = new Promise<string>((resolve) => {
			releaseStart = resolve;
		});
		const startSpy = vi
			.spyOn(FakeChildManager.prototype, "start")
			.mockImplementationOnce(() => startHeld);

		// Mutation-killing signal: the `owned` flag at each emission.
		// Fix: third event is {origin, owned: true} from startOwnRuntime.
		// Bug: leaked recovery probe emits {origin, owned: false} during
		// the spawn window, and startOwnRuntime's setUrl(url, true) is
		// then suppressed by the no-op-on-same-URL guard inside setUrl.
		const events: Array<{ url: string | null; owned: boolean }> = [];
		let restartPromise: Promise<void> | null = null;
		orchestrator.on("url-changed", (u) => {
			events.push({ url: u, owned: orchestrator.isOwned() });
			if (u === null && restartPromise === null) {
				// Synchronous re-entry — restart's sync prefix
				// (stopRecoveryProbe) runs inside this emit.
				restartPromise = orchestrator.restart();
			}
		});

		// Crash the attached runtime → handleCrash runs.
		healthy = false;
		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(100);

		// Bring origin back so any leaked probe (bug) finds it healthy.
		healthy = true;

		// Tick past the recovery interval while spawn is held. Bug:
		// leaked probe fires here and emits url-changed(origin, false).
		await vi.advanceTimersByTimeAsync(50);
		await vi.advanceTimersByTimeAsync(50);
		await vi.advanceTimersByTimeAsync(50);

		// Release spawn → startOwnRuntime resolves → setUrl(url, true).
		releaseStart("http://127.0.0.1:3484");
		// Drain restart's full pipeline including the post-await
		// setUrl(url, true). Without awaiting this, the assertions
		// would race the spawn's continuation.
		await restartPromise;

		// Mutation signal — the `owned` flag on the final emit.
		//   FIX:  events = [{null,false}, {url,true}]   ← startOwnRuntime
		//   BUG:  events = [{null,false}, {url,false}]  ← leaked recovery
		//         probe re-attaches before spawn lands; startOwnRuntime's
		//         setUrl(url, true) is then no-op'd by the same-URL guard.
		expect(events).toEqual([
			{ url: null, owned: false },
			{ url: "http://127.0.0.1:3484", owned: true },
		]);

		startSpy.mockRestore();
	});


	it("does not emit a spurious 'crashed' event when the child crashes during restart's shutdown", async () => {

		const fetchImpl = vi.fn(
			async () => okResponse(),
		) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 200,
		});

		// Land in owned mode with a real (mocked) child manager.
		await orchestrator.connect();
		await orchestrator.restart();
		expect(orchestrator.isOwned()).toBe(true);

		const ownedManager = childManagers.at(-1);
		expect(ownedManager).toBeDefined();

		// Simulate the worst case: graceful shutdown times out → child
		// gets SIGKILL'd → manager emits `crashed` from inside its own
		// shutdown(). Without the listener-detach fix, this re-enters
		// `handleCrash` with `terminated === false` (we're mid-restart,
		// not mid-shutdown) and emits a spurious top-level `crashed`.
		const crashedSpy = vi.fn();
		const urlChanges: Array<string | null> = [];
		orchestrator.on("crashed", crashedSpy);
		orchestrator.on("url-changed", (u) => urlChanges.push(u));

		const shutdownSpy = vi
			.spyOn(FakeChildManager.prototype, "shutdown")
			.mockImplementationOnce(async function (
				this: InstanceType<typeof FakeChildManager>,
			) {
				// Fire crashed mid-shutdown, exactly the SIGKILL-after-timeout
				// case greptile flagged.
				this.emit("crashed", -1, "SIGKILL", "");
			});

		await orchestrator.restart();

		// Mutation-killing assertion: no spurious top-level `crashed`
		// event reached listeners. With the bug (listeners still
		// attached during shutdown await), this would be 1.
		expect(crashedSpy).not.toHaveBeenCalled();

		// Restart still completed normally — orchestrator is back in
		// owned mode at the same origin.
		expect(orchestrator.isOwned()).toBe(true);
		expect(orchestrator.getUrl()).toBe("http://127.0.0.1:3484");

		// And the recovery probe wasn't armed mid-restart (no spurious
		// fetches to the lastKnownOrigin during the restart window).
		// Advance well past the recovery interval; if the bug re-armed
		// the probe, it would have fired before startOwnRuntime resolved.
		const callsAfterRestart = (
			fetchImpl as unknown as ReturnType<typeof vi.fn>
		).mock.calls.length;
		await vi.advanceTimersByTimeAsync(500);
		expect(
			(fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
		).toBe(callsAfterRestart);

		shutdownSpy.mockRestore();
	});

	it("emits url-changed exactly once per public-API URL transition (contract-lock)", async () => {


		const fetchImpl = vi.fn(async () => ({ ok: false }) as Response);
		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		const emitted: (string | null)[] = [];
		orchestrator.on("url-changed", (url) => emitted.push(url));

		// connect() → startOwnRuntime() → setUrl("http://127.0.0.1:3484", true)
		// One transition: null → http://127.0.0.1:3484.
		await orchestrator.connect();
		expect(emitted).toEqual(["http://127.0.0.1:3484"]);

		// restart() → setUrl(null, false) → manager.shutdown → startOwnRuntime →
		// setUrl("http://127.0.0.1:3484", true). Two transitions:
		//   url → null  (clear before shutdown)
		//   null → url  (after fresh spawn)
		await orchestrator.restart();
		expect(emitted).toEqual([
			"http://127.0.0.1:3484",
			null,
			"http://127.0.0.1:3484",
		]);

		// shutdown() → setUrl(null, false). One more transition: url → null.
		await orchestrator.shutdown();
		expect(emitted).toEqual([
			"http://127.0.0.1:3484",
			null,
			"http://127.0.0.1:3484",
			null,
		]);
	});

});

// ---------------------------------------------------------------------
// Health-probe runtime-identification
//
// `checkHealth` must do more than `res.ok`: any local service on the
// runtime port that returns 2xx (a stale dev server, a misconfigured
// reverse proxy, an unrelated developer tool) would otherwise count as
// "kanban runtime found", and the Electron shell would attach to it and
// expose `window.desktop` IPC to the foreign origin. The fix requires
// the response body to contain `<title>Kanban</title>` — which every
// Kanban runtime in history serves as part of the browser-tab UX, so
// the contract is implicit-but-stable rather than requiring a bespoke
// marker that producer (web-ui) and consumer (desktop) have to keep in
// sync. See the docstring on `KANBAN_RUNTIME_TITLE` in
// `runtime-orchestrator.ts` for the rationale.
//
// These tests deliberately use raw fetch mocks (not `okResponse()`) so
// the title requirement is exercised directly rather than through the
// shared healthy-response helper.
// ---------------------------------------------------------------------
describe("RuntimeOrchestrator health-probe runtime identification", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		childManagers.length = 0;
	});
	afterEach(async () => {
		vi.useRealTimers();
	});

	it("rejects a 200 response that does not contain <title>Kanban</title>", async () => {
		// Simulate a foreign service: returns 200 with an arbitrary body.
		// `connect()` should *not* attach — it should fall through to
		// startOwnRuntime() and spawn its own child.
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			text: async () => "<html><body>some other local service</body></html>",
		})) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		await orchestrator.connect();
		expect(orchestrator.isOwned()).toBe(true);
		expect(childManagers.length).toBe(1);

		await orchestrator.shutdown();
	});

	it("attaches to a 200 response that contains <title>Kanban</title>", async () => {
		// Covers the common case AND the back-compat case (older globally-
		// linked CLIs that predate any of this branch's changes still serve
		// `<title>Kanban</title>` because it's a product requirement —
		// browser tab labels — not something this branch added).
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			text: async () => `<!doctype html><html><head>
				<title>Kanban</title>
			</head><body></body></html>`,
		})) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		await orchestrator.connect();
		// Attached, not owned — and no child manager was constructed.
		expect(orchestrator.isOwned()).toBe(false);
		expect(orchestrator.getUrl()).toBe("http://127.0.0.1:3484");
		expect(childManagers.length).toBe(0);

		await orchestrator.shutdown();
	});

	it("checkHealth() public method returns false for title-less 200", async () => {
		// Direct API-surface check — guards against the title grep being
		// regressed into a no-op (e.g. someone removing the .text() read
		// during a refactor).
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			text: async () => "<html><title>not us</title></html>",
		})) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		expect(await orchestrator.checkHealth("http://127.0.0.1:3484")).toBe(false);

		await orchestrator.dispose();
	});
});



