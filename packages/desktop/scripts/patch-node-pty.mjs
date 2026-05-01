#!/usr/bin/env node
/**
 * Patch node-pty's unixTerminal.js to prevent double-suffixing when
 * app.asar.unpacked paths already exist. Exits non-zero on drift.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODE_PTY_DIR = join(__dirname, "..", "node_modules", "node-pty");
const TARGET_FILE = join(NODE_PTY_DIR, "lib", "unixTerminal.js");

/**
 * @typedef {{ name: string, pre: string, post: string }} Replacement
 * @typedef {{ name: string, status: "patched" | "already" | "drift" }} Result
 */

/** @type {Replacement[]} */
export const REPLACEMENTS = [
	{
		name: "app.asar → app.asar.unpacked",
		pre: "helperPath.replace('app.asar', 'app.asar.unpacked')",
		post: "helperPath.replace(/app\\.asar(?!\\.unpacked)/, 'app.asar.unpacked')",
	},
	{
		name: "node_modules.asar → node_modules.asar.unpacked",
		pre: "helperPath.replace('node_modules.asar', 'node_modules.asar.unpacked')",
		post: "helperPath.replace(/node_modules\\.asar(?!\\.unpacked)/, 'node_modules.asar.unpacked')",
	},
];

/**
 * Pure function: given file contents, return the post-patch contents and a
 * status for every configured replacement. Exported for tests.
 *
 * @param {string} original
 * @param {Replacement[]} [replacements]
 * @returns {{ content: string, results: Result[] }}
 */
export function patchContent(original, replacements = REPLACEMENTS) {
	let content = original;
	/** @type {Result[]} */
	const results = [];
	for (const { name, pre, post } of replacements) {
		if (content.includes(post)) {
			results.push({ name, status: "already" });
			continue;
		}
		if (content.includes(pre)) {
			// `replaceAll` so future node-pty versions that ship the same
			// call site twice are both patched.
			content = content.replaceAll(pre, post);
			results.push({ name, status: "patched" });
			continue;
		}
		results.push({ name, status: "drift" });
	}
	return { content, results };
}

function resolveNodePtyVersion() {
	try {
		const require = createRequire(import.meta.url);
		return require(join(NODE_PTY_DIR, "package.json")).version;
	} catch {
		return "unknown";
	}
}

// Only execute the file-mutating side effect when the script is run
// directly (e.g. via `npm run postinstall`). When this module is
// imported by a test, skip the side effect and let the test drive
// `patchContent` with fixture strings.
const isDirectRun = fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
	if (!existsSync(TARGET_FILE)) {
		console.error(
			`patch-node-pty: ERROR — node-pty not installed at ${TARGET_FILE}. ` +
				`Run \`npm install\` in packages/desktop first.`,
		);
		process.exit(1);
	}

	const original = readFileSync(TARGET_FILE, "utf8");
	const { content, results } = patchContent(original);

	const drifted = results.filter((r) => r.status === "drift");
	if (drifted.length > 0) {
		const version = resolveNodePtyVersion();
		console.error(
			[
				`patch-node-pty: ERROR — node-pty@${version} source drifted.`,
				`Expected pre- or post-patch pattern missing for: ${drifted.map((r) => `"${r.name}"`).join(", ")}.`,
				`File: ${TARGET_FILE}`,
				"",
				"What this means:",
				"  node-pty's helperPath.replace(...) call(s) changed shape, probably after a version bump.",
				"  The packaged Electron DMG will silently ship an unpatched node-pty and terminal",
				"  features will break at runtime with `posix_spawn: ENOENT` against a `.unpacked.unpacked`",
				"  path.",
				"",
				"What to do:",
				"  1. Open unixTerminal.js and locate the current helperPath.replace(...) call(s).",
				"  2. Update the REPLACEMENTS array in:",
				`       ${fileURLToPath(import.meta.url)}`,
				"     so that each entry's `pre` matches the current upstream source.",
				"  3. Re-run `npm install` (or `npm run postinstall`) and confirm output is clean.",
			].join("\n"),
		);
		process.exit(1);
	}

	if (content !== original) {
		writeFileSync(TARGET_FILE, content);
	}

	for (const { name, status } of results) {
		console.log(`patch-node-pty: ${status.padEnd(7)} ${name}`);
	}
}
