#!/usr/bin/env node
/**
 * generate-icons.mjs
 *
 * Copies the canonical 512×512 app icon into packages/desktop/build/ so that
 * electron-builder can locate it during packaging.
 *
 * electron-builder accepts either icon.ico or icon.png in the buildResources
 * directory (defaults to "build/").  When only a .png is present, it will
 * auto-convert to .ico on macOS and Linux hosts.  On Windows CI without image
 * conversion tools, provide a pre-built icon.ico instead (see below).
 *
 * Usage:
 *   node packages/desktop/scripts/generate-icons.mjs
 *
 * Optional: If ImageMagick (`magick` or `convert`) is available, the script
 * also generates a proper multi-resolution icon.ico containing 16, 32, 48,
 * 64, 128, and 256 px layers.
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SOURCE_PNG = resolve(__dirname, "../../../web-ui/public/assets/icon-512.png");
const BUILD_DIR = resolve(__dirname, "../build");
const OUT_PNG = resolve(BUILD_DIR, "icon.png");
const OUT_ICO = resolve(BUILD_DIR, "icon.ico");

// Ensure build directory exists
if (!existsSync(BUILD_DIR)) {
	mkdirSync(BUILD_DIR, { recursive: true });
}

// Always copy the PNG source
if (!existsSync(SOURCE_PNG)) {
	console.error(`ERROR: Source icon not found at ${SOURCE_PNG}`);
	process.exit(1);
}

copyFileSync(SOURCE_PNG, OUT_PNG);
console.log(`✔ Copied icon.png → ${OUT_PNG}`);

// Try to generate a proper .ico with ImageMagick (optional)
const magickBin = (() => {
	for (const cmd of ["magick", "convert"]) {
		try {
			execSync(`${cmd} --version`, { stdio: "ignore" });
			return cmd;
		} catch {
			// not available
		}
	}
	return null;
})();

if (magickBin) {
	try {
		// Build multi-resolution ICO: 16, 32, 48, 64, 128, 256
		const sizes = [16, 32, 48, 64, 128, 256];
		const resizeArgs = sizes
			.map((s) => `\\( "${SOURCE_PNG}" -resize ${s}x${s} \\)`)
			.join(" ");
		execSync(`${magickBin} ${resizeArgs} "${OUT_ICO}"`, { stdio: "inherit" });
		console.log(`✔ Generated multi-resolution icon.ico → ${OUT_ICO}`);
	} catch (err) {
		console.warn(`⚠ ImageMagick .ico generation failed: ${err.message}`);
		console.warn("  electron-builder will auto-convert icon.png → .ico at build time.");
	}
} else {
	console.log(
		"ℹ ImageMagick not found — electron-builder will auto-convert icon.png → .ico at build time.",
	);
}
