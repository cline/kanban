/**
 * Patch node-pty's unixTerminal.js to prevent double-suffixing of
 * `app.asar.unpacked` paths.
 *
 * node-pty ships with:
 *   helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');
 *
 * When ALL node_modules are unpacked (asarUnpack: ["node_modules/**"]),
 * the path already contains `app.asar.unpacked`. The naive string replace
 * matches `app.asar` within `app.asar.unpacked` and produces
 * `app.asar.unpacked.unpacked` — which doesn't exist, causing
 * posix_spawn ENOENT at runtime.
 *
 * This patch changes the replace to a negative-lookahead regex that only
 * matches `app.asar` when NOT already followed by `.unpacked`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, "..", "node_modules", "node-pty", "lib", "unixTerminal.js");

let content = readFileSync(file, "utf8");
let patched = false;

// Fix the app.asar replacement
if (content.includes("helperPath.replace('app.asar', 'app.asar.unpacked')")) {
	content = content.replace(
		"helperPath.replace('app.asar', 'app.asar.unpacked')",
		"helperPath.replace(/app\\.asar(?!\\.unpacked)/, 'app.asar.unpacked')",
	);
	patched = true;
}

// Fix the node_modules.asar replacement (same issue)
if (content.includes("helperPath.replace('node_modules.asar', 'node_modules.asar.unpacked')")) {
	content = content.replace(
		"helperPath.replace('node_modules.asar', 'node_modules.asar.unpacked')",
		"helperPath.replace(/node_modules\\.asar(?!\\.unpacked)/, 'node_modules.asar.unpacked')",
	);
	patched = true;
}

if (patched) {
	writeFileSync(file, content);
	console.log("patch-node-pty: patched helperPath replacements to prevent double-suffix");
} else {
	console.log("patch-node-pty: no patch needed (already patched or format changed)");
}
