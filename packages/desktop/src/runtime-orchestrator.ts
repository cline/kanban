import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { powerSaveBlocker } from "electron";

import { RuntimeChildManager } from "./runtime-child.js";


interface RuntimeOrchestratorOptions {

	host: string;
	port: number;
	healthTimeoutMs: number;
	resolveCliShimPath: () => string;
	fetchImpl?: typeof fetch;
	attachedProbeIntervalMs?: number;
	attachedProbeFailureThreshold?: number;
	recoveryProbeIntervalMs?: number;
}

interface RuntimeOrchestratorEventMap {
	"url-changed": [url: string | null];
	crashed: [];
}

// Aggressive — defends against the attached runtime's own bundled web-ui
// rendering a stale in-app disconnected fallback before ours can take over.
const DEFAULT_ATTACHED_PROBE_INTERVAL_MS = 500;
const DEFAULT_ATTACHED_PROBE_FAILURE_THRESHOLD = 2;
const DEFAULT_RECOVERY_PROBE_INTERVAL_MS = 2_000;
const DEFAULT_CHILD_SHUTDOWN_TIMEOUT_MS = 5_000;
const POWER_SAVE_BLOCKER_INACTIVE = -1;

/**
 * Health probe requires `<title>Kanban</title>` in the response body so
 * the desktop shell does not attach to an unrelated local service that
 * happens to be listening on the runtime port (which would expose the
 * `window.desktop` IPC bridge to that service's origin).
 */
export const KANBAN_RUNTIME_TITLE = "<title>Kanban</title>";

export class RuntimeOrchestrator extends EventEmitter<RuntimeOrchestratorEventMap> {

	private manager: RuntimeChildManager | null = null;
	private url: string | null = null;
	private ownsChild = false;
	private connectPromise: Promise<void> | null = null;
	private restartPromise: Promise<void> | null = null;
	private powerSaveBlockerId = POWER_SAVE_BLOCKER_INACTIVE;
	private attachedProbeTimer: NodeJS.Timeout | null = null;
	private attachedProbeFailures = 0;
	private recoveryProbeTimer: NodeJS.Timeout | null = null;
	private attachedProbeInFlight = false;
	private recoveryProbeInFlight = false;
	private lastKnownOrigin: string | null = null;
	// Monotonic generation counters used to invalidate in-flight probe ticks
	// across lifecycle transitions (restart/shutdown/dispose). The interval
	// timer can be cleared, but a tick already past the timer-fire boundary
	// is still awaiting `checkHealth` and would otherwise mutate state long
	// after the orchestrator has moved on. Each tick captures the gen at
	// entry and re-checks after every `await`; `stopX()` increments the
	// counter so any captured gen is now stale.
	private attachedProbeGen = 0;
	private recoveryProbeGen = 0;
	// Resolved + validated CLI shim path. Cached on first lookup so we
	// don't re-resolve on every child spawn (the option's
	// `resolveCliShimPath` is deterministic — it depends only on
	// `app.isPackaged` and `process.platform` — but re-running the same
	// `path.join` on every restart is wasteful, and more importantly we
	// want validation to run *once* with a clear, actionable error so a
	// missing shim doesn't surface as an opaque ENOENT from `child_process`
	// at spawn time. Initial value `null` distinguishes "not yet looked
	// up" from "looked up and resolved to a string".
	private cachedShimPath: string | null = null;

	// Latched once `shutdown()` / `dispose()` begin. Every `await` boundary
	// in the lifecycle methods (`connect`, `restart`, `startOwnRuntime`)
	// re-checks this flag and bails without side-effects when it flips.
	// Closes the otherwise-open race where a slow `checkHealth` /
	// `manager.start()` returns *after* the user has quit, and the
	// continuation would either resurrect URL state on a torn-down
	// orchestrator or spawn an orphan child process with no owner left
	// to ever shut it down. Probe gen tokens cover the inner ticks; this
	// flag is the equivalent for the outer promises.
	private terminated = false;

	constructor(private readonly opts: RuntimeOrchestratorOptions) {
		super();
	}

	getUrl(): string | null {
		return this.url;
	}

	isOwned(): boolean {
		return this.ownsChild;
	}

	defaultOrigin(): string {
		return `http://${this.opts.host}:${this.opts.port}`;
	}

	async checkHealth(origin: string): Promise<boolean> {
		const fetchFn = this.opts.fetchImpl ?? globalThis.fetch;
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(),
			this.opts.healthTimeoutMs,
		);
		try {
			const res = await fetchFn(`${origin}/`, {
				signal: controller.signal,
			});
			if (!res.ok) return false;
			// See `KANBAN_RUNTIME_TITLE` for why a body match is required.
			const body = await res.text();
			return body.includes(KANBAN_RUNTIME_TITLE);
		} catch {

			return false;
		} finally {
			clearTimeout(timer);
		}
	}


	async connect(): Promise<void> {
		if (this.terminated) return;
		if (this.connectPromise) {
			await this.connectPromise;
			return;
		}
		this.connectPromise = (async () => {
			const origin = this.defaultOrigin();
			const healthy = await this.checkHealth(origin);
			// Re-check after the await: a `dispose()` / `shutdown()` may have
			// fired during the in-flight health probe. Without this guard
			// the IIFE would keep going and `setUrl(origin, false)` on a
			// torn-down orchestrator (or call `startOwnRuntime` and spawn
			// an orphan child after teardown).
			if (this.terminated) return;
			if (healthy) {
				console.log(`[desktop] Found existing runtime at ${origin}`);
				this.setUrl(origin, /* owns */ false);
				return;
			}
			console.log("[desktop] No runtime found — starting child process.");
			await this.startOwnRuntime();
		})().finally(() => {
			this.connectPromise = null;
		});
		await this.connectPromise;
	}

	async restart(): Promise<void> {
		if (this.terminated) return;
		if (this.restartPromise) {
			await this.restartPromise;
			return;
		}
		this.stopAttachedProbe();
		this.stopRecoveryProbe();
		this.restartPromise = (async () => {
			// Let an in-flight connect() finish before tearing the manager
			// down, otherwise shutdown() races with the initial spawn. The
			// URL clear has to happen *after* this join — clearing earlier
			// would be overwritten by the connect()'s own setUrl().
			if (this.connectPromise) {
				await this.connectPromise.catch(() => {});
			}
			if (this.terminated) return;
			// Drop the URL before `manager.shutdown()` so `getUrl()` doesn't
			// keep returning the dead origin during the multi-second graceful
			// shutdown window. Without this hoist, anything that queries
			// `getUrl()` mid-restart (e.g. `loadUrlInAllWindows` triggered
			// from a new BrowserWindow) would load the about-to-be-killed
			// origin. Also covers attached-mode → restart, where the
			// shutdown branch below is skipped entirely.
			this.setUrl(null, /* owns */ false);
			if (this.manager) {
				// Detach `crashed` / `error` listeners *before* awaiting
				// `manager.shutdown()`. If the child times out and gets
				// SIGKILL'd, the manager fires a final `crashed` event
				// during graceful shutdown — and during `restart()` the
				// `terminated` flag is still false, so `handleCrash` would
				// emit a spurious `"crashed"` to listeners (e.g. a UI
				// dialog) and arm a recovery probe that immediately gets
				// cancelled by the imminent `startOwnRuntime()`. The
				// distinguishing semantics of restart vs crash is "I
				// asked for this teardown" — and that's encoded by
				// silencing the listeners up front.
				const dyingManager = this.manager;
				dyingManager.removeAllListeners("crashed");
				dyingManager.removeAllListeners("error");
				this.manager = null;
				await dyingManager.shutdown().catch((err) => {
					console.warn(
						"[desktop] Runtime shutdown during restart failed:",
						err instanceof Error ? err.message : err,
					);
				});
			}
			if (this.terminated) return;
			await this.startOwnRuntime();

		})().finally(() => {
			this.restartPromise = null;
		});
		await this.restartPromise;
	}

	async shutdown(): Promise<void> {
		if (this.terminated) return;
		// Latch *before* the awaits so any in-flight `connect`/`restart`
		// continuation that resumes during this drain sees the flag and
		// bails without side effects.
		this.terminated = true;
		// Drain in-flight lifecycle promises so we don't tear down the
		// manager while `manager.start()` is still spawning a child. After
		// the drain, the IIFE's post-await `terminated` check turns the
		// continuation into a no-op (or routes a just-spawned child into
		// the orphan-cleanup branch in `startOwnRuntime`).
		if (this.connectPromise) await this.connectPromise.catch(() => {});
		if (this.restartPromise) await this.restartPromise.catch(() => {});

		this.stopAppNapPrevention();
		this.stopAttachedProbe();
		this.stopRecoveryProbe();
		if (this.manager && this.ownsChild) {
			await this.manager.shutdown().catch((err) => {
				console.error(
					"[desktop] Runtime shutdown error:",
					err instanceof Error ? err.message : err,
				);
			});
		}
		// Clear orchestrator state so post-shutdown observers (`getUrl()`,
		// `isOwned()`) reflect "disconnected", and any subsequent
		// `connect()`/`startOwnRuntime()` does not reuse the dead manager
		// via the `if (!this.manager)` short-circuit. Routing through
		// `setUrl(null, false)` keeps lifecycle transitions consistent —
		// it emits `url-changed(null)` for any window listening, and stops
		// the attached probe in case it was somehow still running.
		if (this.manager) {
			this.manager.removeAllListeners("crashed");
			this.manager.removeAllListeners("error");
			this.manager = null;
		}
		this.setUrl(null, /* owns */ false);
	}

	async dispose(): Promise<void> {
		if (this.terminated) return;
		this.terminated = true;
		// Same drain as `shutdown()` — see the rationale there.
		if (this.connectPromise) await this.connectPromise.catch(() => {});
		if (this.restartPromise) await this.restartPromise.catch(() => {});

		// Same teardown as `shutdown()` plus `manager.dispose()`. Symmetric
		// state clear so post-dispose `getUrl()`/`isOwned()` don't lie.
		this.stopAppNapPrevention();
		this.stopRecoveryProbe();
		this.stopAttachedProbe();
		// Capture the manager reference before the await: a `crashed` event
		// can fire during `manager.dispose()` and re-enter `handleCrash`,
		// which would set `this.manager = null` mid-flight. Without the
		// local capture, the listener-removal calls below would throw
		// `Cannot read properties of null` and surface as an unhandled
		// rejection from `dispose()`. The post-await `this.manager ===
		// manager` re-check guards against the same case from the other
		// direction (don't null a manager somebody else already replaced).
		const manager = this.manager;
		if (manager) {
			await manager.dispose().catch((err) => {
				console.warn(
					"[desktop] Runtime dispose failed:",
					err instanceof Error ? err.message : err,
				);
			});
			manager.removeAllListeners("crashed");
			manager.removeAllListeners("error");
			if (this.manager === manager) this.manager = null;
		}
		this.setUrl(null, /* owns */ false);
	}


	startAppNapPrevention(): void {
		if (this.powerSaveBlockerId !== POWER_SAVE_BLOCKER_INACTIVE) return;
		this.powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
	}

	stopAppNapPrevention(): void {
		if (this.powerSaveBlockerId === POWER_SAVE_BLOCKER_INACTIVE) return;
		powerSaveBlocker.stop(this.powerSaveBlockerId);
		this.powerSaveBlockerId = POWER_SAVE_BLOCKER_INACTIVE;
	}

	private async startOwnRuntime(): Promise<void> {
		// Skip the spawn entirely if a teardown already began. Without
		// this, a `connect()` IIFE that fell through to `startOwnRuntime`
		// after `dispose()` cleared the URL would still create a fresh
		// `RuntimeChildManager` and spawn an orphan child process.
		if (this.terminated) return;
		if (!this.manager) {
			this.manager = this.createManager();
		}
		try {
			const url = await this.manager.start({
				host: this.opts.host,
				port: this.opts.port,
			});
			if (this.terminated) {
				// `shutdown()` / `dispose()` fired while `manager.start()`
				// was still spawning. The child is now alive but the
				// orchestrator is torn down — clean up the orphan
				// directly here so we don't leak a runtime process.
				// `shutdown()`/`dispose()` themselves can't catch this:
				// they sampled `this.manager` before the spawn completed
				// (it was created in `createManager()` above, but only
				// became *running* with a real child after the await
				// resolved), and by the time their drain unblocks they've
				// already moved past the manager-teardown branch.
				//
				// Capture the manager reference before the await for the
				// same reason as `dispose()`: a `crashed` event during
				// `manager.shutdown()` re-enters `handleCrash`, which sets
				// `this.manager = null`. Without the local capture, the
				// post-await listener-removal would throw `Cannot read
				// properties of null` — silently swallowed by the drain's
				// `.catch(() => {})` in shutdown/dispose, but still wrong:
				// the listener-removal never runs, leaving stale
				// `crashed`/`error` listeners attached to the doomed
				// manager. The `this.manager === manager` re-check before
				// nulling guards against racing with anybody else who
				// already replaced the field.
				const manager = this.manager;
				await manager.shutdown().catch(() => {});
				manager.removeAllListeners("crashed");
				manager.removeAllListeners("error");
				if (this.manager === manager) this.manager = null;
				return;
			}

			this.setUrl(url, /* owns */ true);
		} catch (err) {
			// On spawn failure, drop the rejected manager so the next
			// `connect()`/`restart()` doesn't reuse this dead instance via
			// the `if (!this.manager)` short-circuit (which would either
			// hide the real failure mode or call `start()` twice on a
			// manager that didn't expect it).
			if (this.manager) {
				this.manager.removeAllListeners("crashed");
				this.manager.removeAllListeners("error");
				this.manager = null;
			}
			// Suppress on terminated — caller (drain inside shutdown/dispose)
			// already moved past the point where it cares about the spawn
			// failure, and re-throwing would surface as an unhandled
			// rejection on the abandoned promise.
			if (this.terminated) return;
			throw err;
		}
	}

	/**
	 * Resolve the CLI shim path on first call and validate it exists. The
	 * path itself is deterministic (depends only on `app.isPackaged` and
	 * `process.platform`), so we cache it after the first lookup. Validation
	 * runs only once: a missing shim is a packaging or dev-stage issue,
	 * not a transient one — re-checking on every restart would just delay
	 * surfacing the same error.
	 *
	 * Throws with an actionable message rather than letting Node fail at
	 * `child_process.spawn` time with an opaque ENOENT — the user sees
	 * exactly which path was checked and the most likely remediation.
	 */
	private getValidatedShimPath(): string {
		if (this.cachedShimPath !== null) return this.cachedShimPath;
		const resolved = this.opts.resolveCliShimPath();
		if (!existsSync(resolved)) {
			throw new Error(
				`CLI shim not found at ${resolved}. ` +
					`In dev, run \`npm run stage:cli\` to populate build/bin/. ` +
					`In packaged builds, this indicates a corrupted install — ` +
					`expected the shim under Resources/bin/.`,
			);
		}
		this.cachedShimPath = resolved;
		return resolved;
	}

	private createManager(): RuntimeChildManager {
		const manager = new RuntimeChildManager({
			cliPath: this.getValidatedShimPath(),
			shutdownTimeoutMs: DEFAULT_CHILD_SHUTDOWN_TIMEOUT_MS,
		});


		manager.on("crashed", (exitCode, signal, stderrTail) => {
			console.error(
				`[desktop] Runtime crashed (code=${exitCode}, signal=${signal})`,
			);
			if (stderrTail.trim().length > 0) {
				console.error(`[desktop] Runtime stderr tail:\n${stderrTail}`);
			}
			this.handleCrash();
		});

		manager.on("error", (message: string) => {
			console.error(`[desktop] Runtime error: ${message}`);
		});

		return manager;
	}

	private handleCrash(): void {
		// Detach listeners on the dead manager before dropping it so a
		// stray `error` from child cleanup can't re-enter `handleCrash`.
		if (this.manager) {
			this.manager.removeAllListeners("crashed");
			this.manager.removeAllListeners("error");
		}
		this.manager = null;
		if (this.terminated) {
			// Teardown raced with the child's own crash; clear URL but
			// don't arm recovery or emit `crashed` to a torn-down owner.
			this.setUrl(null, /* owns */ false);
			return;
		}
		// Arm recovery BEFORE the synchronous `setUrl(null)` emit. A
		// `url-changed` listener that calls `restart()` synchronously
		// must see an already-armed probe to stop — otherwise its
		// `stopRecoveryProbe()` runs first, then handleCrash arms a
		// fresh probe AFTER restart cleaned up, and that stray probe
		// can re-attach to the dead origin during restart's spawn
		// window before `startOwnRuntime` lands the new URL.
		this.startRecoveryProbe();
		this.setUrl(null, /* owns */ false);
		this.emit("crashed");
	}



	private setUrl(url: string | null, ownsChild: boolean): void {
		const urlChanged = url !== this.url;
		if (url) {
			this.lastKnownOrigin = url;
			this.stopRecoveryProbe();
		}
		this.url = url;
		this.ownsChild = ownsChild;
		// `url-changed` is the signal that drives `loadUrlInAllWindows()` in
		// main.ts — fire it only when the URL itself actually changed.
		// An ownership-only transition (same origin, owned ↔ attached) does
		// not change what renderers should be loading, so triggering a full
		// reload would be wasteful and visible as a flash. Currently no call
		// site actually produces a same-URL/different-owns transition, but
		// keeping this guard tight means any future hot-handover code path
		// won't need to re-prove this property; it falls out of the contract.
		if (urlChanged) {
			this.emit("url-changed", url);
		}


		// Owned children emit "crashed" directly via process.exit; only
		// attached runtimes need polling to detect crashes.
		if (url && !ownsChild) {
			this.startAttachedProbe(url);
		} else {
			this.stopAttachedProbe();
		}
	}

	private startAttachedProbe(origin: string): void {
		this.stopAttachedProbe();
		const intervalMs =
			this.opts.attachedProbeIntervalMs ?? DEFAULT_ATTACHED_PROBE_INTERVAL_MS;
		if (intervalMs <= 0) return;

		const threshold =
			this.opts.attachedProbeFailureThreshold ??
			DEFAULT_ATTACHED_PROBE_FAILURE_THRESHOLD;
		this.attachedProbeFailures = 0;

		// Capture the generation that's valid for this probe lifetime. Any
		// `stopAttachedProbe()` (including the implicit one inside
		// `restart()` / `shutdown()` / `dispose()`) will bump the counter,
		// invalidating ticks that have already advanced past their timer
		// fire and are awaiting `checkHealth`.
		const gen = ++this.attachedProbeGen;

		// `setInterval` doesn't await the previous tick — if `checkHealth`
		// hangs longer than `intervalMs` (slow runtime, network blip), naive
		// scheduling would stack overlapping probes and inflate the failure
		// count. Skip ticks while one is in flight.
		const tick = async (): Promise<void> => {
			if (gen !== this.attachedProbeGen) return;
			if (this.attachedProbeInFlight) return;
			if (this.url !== origin || this.ownsChild) return;
			this.attachedProbeInFlight = true;
			try {
				const healthy = await this.checkHealth(origin);
				if (gen !== this.attachedProbeGen) return;
				if (this.url !== origin || this.ownsChild) return;
				if (healthy) {
					this.attachedProbeFailures = 0;
					return;
				}
				this.attachedProbeFailures += 1;
				if (this.attachedProbeFailures >= threshold) {
					console.error(
						`[desktop] Attached runtime at ${origin} unreachable after ${this.attachedProbeFailures} probes — classifying as crashed.`,
					);
					this.stopAttachedProbe();
					this.handleCrash();
				}
			} finally {
				this.attachedProbeInFlight = false;
			}
		};

		this.attachedProbeTimer = setInterval(() => {
			// Listener exceptions inside `setUrl → emit` would otherwise
			// surface as unhandled rejections via `void tick()`. Catch and
			// log them locally — a rogue listener shouldn't take down the
			// orchestrator's monitoring loop.
			tick().catch((err) => {
				console.warn(
					"[desktop] Attached probe tick error:",
					err instanceof Error ? err.message : err,
				);
			});
		}, intervalMs);
		this.attachedProbeTimer.unref();
	}

	private stopAttachedProbe(): void {
		this.attachedProbeGen += 1;
		if (this.attachedProbeTimer) {
			clearInterval(this.attachedProbeTimer);
			this.attachedProbeTimer = null;
		}
		this.attachedProbeFailures = 0;
	}

	private startRecoveryProbe(): void {
		this.stopRecoveryProbe();
		const origin = this.lastKnownOrigin;
		if (!origin) return;
		const intervalMs =
			this.opts.recoveryProbeIntervalMs ?? DEFAULT_RECOVERY_PROBE_INTERVAL_MS;
		if (intervalMs <= 0) return;

		// Capture the generation valid for this probe lifetime. Critical
		// for the `restart()` race: that path *intentionally* leaves
		// `this.url === null` until `startOwnRuntime()` resolves, so the
		// post-await `url !== null` check below cannot distinguish "still
		// crashed" from "mid-restart". The gen check fills that gap — when
		// `restart()` calls `stopRecoveryProbe()`, the gen advances and a
		// late-arriving `checkHealth` resolution becomes a no-op instead
		// of overwriting state that `startOwnRuntime()` is about to set.
		const gen = ++this.recoveryProbeGen;

		const tick = async (): Promise<void> => {
			if (gen !== this.recoveryProbeGen) return;
			if (this.recoveryProbeInFlight) return;
			if (this.url !== null) {
				this.stopRecoveryProbe();
				return;
			}
			this.recoveryProbeInFlight = true;
			try {
				const healthy = await this.checkHealth(origin);
				if (gen !== this.recoveryProbeGen) return;
				if (this.url !== null) return;
				if (!healthy) return;
				console.log(
					`[desktop] Recovery probe found runtime at ${origin} — auto-attaching.`,
				);
				this.setUrl(origin, /* owns */ false);
			} finally {
				this.recoveryProbeInFlight = false;
			}
		};

		this.recoveryProbeTimer = setInterval(() => {
			tick().catch((err) => {
				console.warn(
					"[desktop] Recovery probe tick error:",
					err instanceof Error ? err.message : err,
				);
			});
		}, intervalMs);
		this.recoveryProbeTimer.unref();
	}

	private stopRecoveryProbe(): void {
		this.recoveryProbeGen += 1;
		if (this.recoveryProbeTimer) {
			clearInterval(this.recoveryProbeTimer);
			this.recoveryProbeTimer = null;
		}
	}
}
