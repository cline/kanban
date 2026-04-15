#!/usr/bin/env node

/**
 * fresh-build.mjs — Nuclear clean + full rebuild of the desktop app.
 *
 * Ensures the DMG always contains the latest code by:
 *   1. Cleaning all caches, node_modules, dist, out, and stale tarballs
 *   2. Installing + building the root kanban package
 *   3. Building the web-ui
 *   4. Packing a fresh kanban tarball
 *   5. Updating packages/desktop/package.json to reference the new tarball version
 *   6. Installing desktop dependencies (with the fresh tarball)
 *   7. Building the arm64 DMG
 *
 * Usage:
 *   node packages/desktop/scripts/fresh-build.mjs [--arch arm64|x64|universal]
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const DESKTOP = resolve(import.meta.dirname, "..");
const WEB_UI = join(ROOT, "web-ui");

const arch = process.argv.includes("--arch")
	? process.argv[process.argv.indexOf("--arch") + 1] || "arm64"
	: "arm64";

const validArches = ["arm64", "x64", "universal"];
if (!validArches.includes(arch)) {
	console.error(`Invalid arch: ${arch}. Must be one of: ${validArches.join(", ")}`);
	process.exit(1);
}

function run(cmd, opts = {}) {
	console.log(`\n▸ ${cmd}`);
	execSync(cmd, { stdio: "inherit", cwd: opts.cwd || ROOT, ...opts });
}

function step(label) {
	console.log(`\n${"═".repeat(60)}`);
	console.log(`  ${label}`);
	console.log(`${"═".repeat(60)}`);
}

// ─── 1. Nuclear clean ────────────────────────────────────────────────────────

step("1/7  Nuclear clean");

const dirsToRemove = [
	join(ROOT, "node_modules"),
	join(ROOT, "dist"),
	join(WEB_UI, "node_modules"),
	join(WEB_UI, "dist"),
	join(DESKTOP, "node_modules"),
	join(DESKTOP, "dist"),
	join(DESKTOP, "out"),
];

for (const dir of dirsToRemove) {
	if (existsSync(dir)) {
		console.log(`  rm -rf ${dir}`);
		rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
	}
}

// Remove stale tarballs from desktop package
for (const file of readdirSync(DESKTOP)) {
	if (file.endsWith(".tgz")) {
		const full = join(DESKTOP, file);
		console.log(`  rm ${full}`);
		rmSync(full, { force: true });
	}
}

// ─── 2. Install root dependencies ────────────────────────────────────────────

step("2/7  Install root dependencies");
run("npm ci");

// ─── 3. Install web-ui dependencies ──────────────────────────────────────────

step("3/7  Install web-ui dependencies");
run("npm ci", { cwd: WEB_UI });

// ─── 4. Build root (kanban runtime + web-ui) ────────────────────────────────

step("4/7  Build kanban");
run("npm run build");

// ─── 5. Pack tarball ─────────────────────────────────────────────────────────

step("5/7  Pack tarball");
run(`npm pack --pack-destination "${DESKTOP}"`);

// Find the tarball
const tarballs = readdirSync(DESKTOP).filter((f) => f.startsWith("kanban-") && f.endsWith(".tgz"));
if (tarballs.length === 0) {
	console.error("ERROR: No kanban-*.tgz found after npm pack");
	process.exit(1);
}
const tarball = tarballs.sort().pop(); // latest
const version = tarball.replace("kanban-", "").replace(".tgz", "");
console.log(`  Tarball: ${tarball} (version ${version})`);

// ─── 6. Update desktop package.json + install ────────────────────────────────

step("6/7  Update desktop package.json + install");

const pkgPath = join(DESKTOP, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const oldRef = pkg.dependencies.kanban;
const newRef = `file:${tarball}`;

if (oldRef !== newRef) {
	console.log(`  Updating kanban dep: ${oldRef} → ${newRef}`);
	pkg.dependencies.kanban = newRef;
	writeFileSync(pkgPath, JSON.stringify(pkg, null, "\t") + "\n");
} else {
	console.log(`  kanban dep already correct: ${newRef}`);
}

// Nuke npm cache and lockfile to prevent stale tarball installs.
// npm caches file: tarballs by version, so same-version rebuilds get
// the old cached tarball instead of the fresh one on disk.
const desktopLock = join(DESKTOP, "package-lock.json");
if (existsSync(desktopLock)) {
	console.log(`  rm ${desktopLock}`);
	rmSync(desktopLock, { force: true });
}
const npmCacheDir = join(process.env.HOME || process.env.USERPROFILE || "", ".npm", "_cacache");
if (existsSync(npmCacheDir)) {
	console.log(`  rm -rf ${npmCacheDir}  (npm tarball cache)`);
	rmSync(npmCacheDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
}

run("npm install", { cwd: DESKTOP });

// Verify
const installedPkg = JSON.parse(readFileSync(join(DESKTOP, "node_modules", "kanban", "package.json"), "utf-8"));
console.log(`  Installed kanban version: ${installedPkg.version}`);
if (installedPkg.version !== version) {
	console.error(`ERROR: Expected ${version}, got ${installedPkg.version}`);
	process.exit(1);
}

// ─── 7. Build DMG ────────────────────────────────────────────────────────────

const buildCmd = arch === "universal"
	? "npm run build:mac:universal"
	: `npm run build:mac:${arch}`;

step(`7/7  Build DMG (${arch})`);
run(buildCmd, { cwd: DESKTOP });

// ─── Done ────────────────────────────────────────────────────────────────────

step("✅ Fresh build complete!");
const dmgs = readdirSync(join(DESKTOP, "out")).filter((f) => f.endsWith(".dmg") && !f.endsWith(".blockmap"));
for (const dmg of dmgs) {
	console.log(`  ${join(DESKTOP, "out", dmg)}`);
}
