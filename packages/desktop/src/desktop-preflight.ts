/**
 * Desktop preflight validation — checks that critical packaged/dev resources
 * exist before the app gets deep into boot.
 *
 * Run this early in the app.whenReady() boot path so that missing preload
 * scripts, runtime child entries, or CLI shims fail deterministically with
 * actionable messages rather than opaque late-boot crashes.
 */

import { existsSync } from "node:fs";

import { resolveChildScriptPath } from "./runtime-child.js";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface DesktopPreflightFailure {
	code:
		| "PRELOAD_MISSING"
		| "RUNTIME_CHILD_ENTRY_MISSING"
		| "CLI_SHIM_MISSING"
		| "NODE_PTY_UNAVAILABLE";
	message: string;
	details?: Record<string, string | boolean | null>;
}

export interface DesktopPreflightOptions {
	/** Absolute path to preload.js. */
	preloadPath: string;
	/** Raw child script path BEFORE asar resolution. */
	childScriptPath: string;
	/** Resolved CLI shim path. */
	cliShimPath: string;
	/** Whether the app is running in a packaged build. */
	isPackaged: boolean;
	/** When true, attempt to verify that node-pty can be loaded. Defaults to false. */
	checkNodePty?: boolean;
}

export interface DesktopPreflightResult {
	ok: boolean;
	failures: DesktopPreflightFailure[];
	resources: {
		preloadExists: boolean;
		runtimeChildEntryExists: boolean;
		cliShimExists: boolean;
		nodePtyLoadable: boolean | null;
	};
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

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

	// 2. Runtime child entry — resolve through the same asar-unpacked logic
	//    that RuntimeChildManager uses at fork() time.
	const resolvedChildPath = resolveChildScriptPath(opts.childScriptPath);
	const runtimeChildEntryExists = existsSync(resolvedChildPath);
	if (!runtimeChildEntryExists) {
		failures.push({
			code: "RUNTIME_CHILD_ENTRY_MISSING",
			message: `Runtime child entry not found at resolved path: ${resolvedChildPath}`,
			details: {
				rawPath: opts.childScriptPath,
				resolvedPath: resolvedChildPath,
				isPackaged: opts.isPackaged,
			},
		});
	}

	// 3. CLI shim
	const cliShimExists = existsSync(opts.cliShimPath);
	if (!cliShimExists) {
		failures.push({
			code: "CLI_SHIM_MISSING",
			message: `CLI shim not found at: ${opts.cliShimPath}`,
			details: { path: opts.cliShimPath, isPackaged: opts.isPackaged },
		});
	}

	// 4. node-pty (optional)
	let nodePtyLoadable: boolean | null = null;
	if (opts.checkNodePty) {
		try {
			require.resolve("node-pty");
			nodePtyLoadable = true;
		} catch {
			nodePtyLoadable = false;
			failures.push({
				code: "NODE_PTY_UNAVAILABLE",
				message: "node-pty could not be resolved. Terminal features may be unavailable.",
			});
		}
	}

	return {
		ok: failures.length === 0,
		failures,
		resources: {
			preloadExists,
			runtimeChildEntryExists,
			cliShimExists,
			nodePtyLoadable,
		},
	};
}
