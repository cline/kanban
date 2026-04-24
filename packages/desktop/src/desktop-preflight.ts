/**
 * Desktop preflight validation — checks that critical packaged/dev resources
 * exist before the app gets deep into boot.
 *
 * Run this early in the app.whenReady() boot path so that a missing preload
 * script or CLI shim fails deterministically with an actionable message
 * rather than an opaque late-boot crash.
 */

import { existsSync } from "node:fs";

/** Codes for hard failures — the app cannot boot correctly until they're fixed. */
export type DesktopPreflightFailureCode = "PRELOAD_MISSING" | "CLI_SHIM_MISSING";

export interface DesktopPreflightFailure {
	code: DesktopPreflightFailureCode;
	message: string;
	details?: Record<string, string | boolean | null>;
}

export interface DesktopPreflightOptions {
	/** Absolute path to preload.js. */
	preloadPath: string;
	/**
	 * Path to the Kanban CLI shim script that the runtime manager will spawn.
	 * In our packaging, this is `Resources/bin/kanban{,.cmd}` — a shell
	 * script that lives OUTSIDE the asar bundle and execs node against the
	 * asar-unpacked `cli/cli.js`. Preflight only needs to verify that this
	 * entry point exists; the shim itself validates the interior binary.
	 */
	cliShimPath: string;
	isPackaged: boolean;
}

export interface DesktopPreflightResult {
	/** `true` if there are no failures. */
	ok: boolean;
	/** Hard failures — the app cannot boot correctly without fixing these. */
	failures: DesktopPreflightFailure[];
	resources: {
		preloadExists: boolean;
		cliShimExists: boolean;
	};
}

export function runDesktopPreflight(
	opts: DesktopPreflightOptions,
): DesktopPreflightResult {
	const failures: DesktopPreflightFailure[] = [];

	// 1. Preload script
	const preloadExists = existsSync(opts.preloadPath);
	if (!preloadExists) {
		failures.push({
			code: "PRELOAD_MISSING",
			message: `Preload script not found at: ${opts.preloadPath}`,
			details: { path: opts.preloadPath, isPackaged: opts.isPackaged },
		});
	}

	// 2. CLI shim — the spawn entry point (RuntimeChildManager invokes this).
	const cliShimExists = existsSync(opts.cliShimPath);
	if (!cliShimExists) {
		failures.push({
			code: "CLI_SHIM_MISSING",
			message: `CLI shim not found at: ${opts.cliShimPath}`,
			details: { path: opts.cliShimPath, isPackaged: opts.isPackaged },
		});
	}

	return {
		ok: failures.length === 0,
		failures,
		resources: {
			preloadExists,
			cliShimExists,
		},
	};
}
