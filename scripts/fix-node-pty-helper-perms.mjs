#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { access, chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

if (process.platform === "win32") {
	process.exit(0);
}

const require = createRequire(import.meta.url);

async function ensureExecutable(path) {
	try {
		await access(path, fsConstants.F_OK);
	} catch {
		return false;
	}

	try {
		await access(path, fsConstants.X_OK);
		return true;
	} catch {
		// Continue to chmod.
	}

	try {
		await chmod(path, 0o755);
		console.log(`[kanban] fixed execute permission: ${path}`);
		return true;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[kanban] could not chmod ${path}: ${message}`);
		return false;
	}
}

async function main() {
	let packageJsonPath;
	try {
		packageJsonPath = require.resolve("node-pty/package.json");
	} catch {
		return;
	}

	const packageRoot = dirname(packageJsonPath);
	const helperCandidates = [
		join(packageRoot, "build/Release/spawn-helper"),
		join(packageRoot, "build/Debug/spawn-helper"),
		join(packageRoot, `prebuilds/${process.platform}-${process.arch}/spawn-helper`),
	];

	for (const helperPath of helperCandidates) {
		if (await ensureExecutable(helperPath)) {
			return;
		}
	}
}

await main();
