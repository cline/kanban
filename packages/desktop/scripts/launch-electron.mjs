#!/usr/bin/env node

/**
 * Electron launch helper — ensures the Electron binary runs as a real
 * Electron app rather than plain Node.js.
 *
 * Why this exists:
 *
 * When the desktop app is launched from within another Electron-based
 * application (e.g. the Cline IDE terminal), the environment often
 * inherits `ELECTRON_RUN_AS_NODE=1`.  That flag tells the Electron
 * binary to behave like vanilla Node.js — which means the built-in
 * `electron` module is never registered, and any `import … from
 * "electron"` (ESM) or `require("electron")` (CJS) in the main
 * process will fail with a module-loading error.
 *
 * This tiny wrapper strips the offending variable from the environment
 * before spawning the real Electron process, guaranteeing a proper app
 * context regardless of the parent shell.
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

child.on("close", (code, signal) => {
	if (code !== null) {
		process.exit(code);
	}
	if (signal) {
		console.error(`Electron exited with signal ${signal}`);
		process.exit(1);
	}
});

// Relay termination signals to the child.
for (const sig of ["SIGINT", "SIGTERM"]) {
	process.on(sig, () => {
		if (!child.killed) {
			child.kill(sig);
		}
	});
}
