#!/usr/bin/env node
/**
 * Stages the runtime + web-ui bundle from root dist/ into packages/desktop/cli/
 * for electron-builder. Validates completeness to fail loudly if the root build
 * was skipped.
 */

import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const repoRoot = resolve(desktopRoot, "../..");
const distDir = resolve(repoRoot, "dist");
const webUiIndex = resolve(distDir, "web-ui/index.html");
const cliEntry = resolve(distDir, "cli.js");
const stageDir = resolve(desktopRoot, "cli");

function fail(message) {
	console.error(`\n[stage:cli] ERROR: ${message}\n`);
	console.error("[stage:cli] Run the root build first:");
	console.error("[stage:cli]   (cd ../.. && npm run build)\n");
	process.exit(1);
}

if (!existsSync(distDir)) {
	fail(`${distDir} does not exist.`);
}
if (!existsSync(cliEntry)) {
	fail(`${cliEntry} is missing.`);
}
if (!existsSync(webUiIndex)) {
	fail(
		`${webUiIndex} is missing — the runtime is built but the web UI assets were not staged into dist/web-ui/.`,
	);
}

rmSync(stageDir, { recursive: true, force: true });
cpSync(distDir, stageDir, { recursive: true });

// The CLI bundle is ESM (esbuild emits `import` statements). Inside the
// packaged app, this file lives at `app.asar.unpacked/cli/cli.js`. Node's
// nearest-package.json walk-up from `app.asar.unpacked/cli/` doesn't see
// the desktop package.json inside the sibling `app.asar` archive, so
// without a local package.json Node defaults to CJS and chokes on the
// `import` statement at module top. Drop a minimal package.json next to
// the staged cli.js so Node treats it as ESM regardless of what lives
// further up the tree.
writeFileSync(
	resolve(stageDir, "package.json"),
	`${JSON.stringify({ type: "module" }, null, 2)}\n`,
);

console.log(`[stage:cli] Staged ${distDir} → ${stageDir}`);
