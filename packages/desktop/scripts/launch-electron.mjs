#!/usr/bin/env node

/**
 * Electron launch helper — strips ELECTRON_RUN_AS_NODE before spawning
 * to ensure the main process can import from "electron".
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");

// Resolve the Electron binary from the local node_modules.
const require = createRequire(import.meta.url);
const electronPath = require("electron");

// Build a sanitised environment — delete the flag that would force
// Electron into "run-as-node" mode.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// Forward any extra CLI arguments (e.g. --inspect).
const extraArgs = process.argv.slice(2);

const child = spawn(electronPath, [resolve(desktopRoot, "dist", "main.js"), ...extraArgs], {
	stdio: "inherit",
	env,
	cwd: desktopRoot,
});

// Surface spawn-time failures (missing binary, EACCES on the Electron
// helper, etc.) instead of letting them manifest as a silent no-output
// exit. Without this handler, a failed spawn emits only the 'error'
// event and never calls the 'close' handler above, so the process would
// exit 0 without a clue as to what went wrong.
child.on("error", (err) => {
	console.error(
		`Failed to launch Electron at ${electronPath}:`,
		err instanceof Error ? err.message : err,
	);
	process.exit(1);
});

child.on("close", (code, signal) => {
	if (code !== null) {
		process.exit(code);
		return;
	}
	if (signal) {
		// Re-raise the same signal on ourselves so the parent shell sees
		// us as "killed by signal X" (exit code 128 + N) rather than as
		// having successfully exited with code 1. Without this, Ctrl-C
		// in a `make` recipe would not abort the recipe (make treats
		// exit-1 as a build failure but specifically distinguishes it
		// from signal-termination), and `npm run` would not propagate
		// the SIGINT to its own parent. We have to first remove our
		// own signal handlers — Node disables the default
		// signal-exit-with-128+N behavior as soon as a handler is
		// installed, so we restore the default before re-raising.
		process.removeAllListeners("SIGINT");
		process.removeAllListeners("SIGTERM");
		process.kill(process.pid, signal);
		// kill() is async on POSIX; this gives the signal a tick to land
		// before falling through to the safety exit below.
		return;
	}
	// Neither code nor signal — should be unreachable on Node, but exit
	// non-zero so a future Node behavior change doesn't make us silently
	// disappear with success.
	process.exit(1);
});

// Relay termination signals to the child. The `process.kill(child.pid, …)`
// syscall is racy with the child's own exit (the child may have already
// died between the OS delivering SIGINT to the parent and us forwarding
// it), so guard with `!child.killed` and swallow ESRCH to keep the
// shutdown path quiet for the common Ctrl-C case.
for (const sig of ["SIGINT", "SIGTERM"]) {
	process.on(sig, () => {
		if (child.killed) return;
		try {
			child.kill(sig);
		} catch (err) {
			// ESRCH = child already gone; nothing to do. Anything else is
			// surprising enough to log.
			if (!err || err.code !== "ESRCH") {
				console.error(
					`Failed to forward ${sig} to Electron child:`,
					err instanceof Error ? err.message : err,
				);
			}
		}
	});
}
