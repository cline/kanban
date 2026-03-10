#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const nodeBinary = process.execPath;
const npmBinary = process.platform === "win32" ? "npm.cmd" : "npm";

function printHelp() {
	console.log("Usage: npm run dogfood -- --project <path> [--port <number|auto>] [--no-open] [--skip-build]");
}

function parseArgs(argv) {
	let project = "";
	let port = "auto";
	let noOpen = false;
	let skipBuild = false;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		}
		if (arg === "--project" || arg === "-p") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("Missing value for --project.");
			}
			project = value;
			index += 1;
			continue;
		}
		if (arg.startsWith("--project=")) {
			project = arg.slice("--project=".length);
			continue;
		}
		if (arg === "--port") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("Missing value for --port.");
			}
			port = value;
			index += 1;
			continue;
		}
		if (arg.startsWith("--port=")) {
			port = arg.slice("--port=".length);
			continue;
		}
		if (arg === "--no-open") {
			noOpen = true;
			continue;
		}
		if (arg === "--skip-build") {
			skipBuild = true;
			continue;
		}
		throw new Error(`Unknown option: ${arg}`);
	}

	if (!project.trim()) {
		throw new Error("Missing required --project <path>.");
	}

	return {
		project: resolve(project.trim()),
		port: port.trim() || "auto",
		noOpen,
		skipBuild,
	};
}

function runCommand(command, args, options = {}) {
	return new Promise((resolveExit, reject) => {
		const child = spawn(command, args, {
			stdio: "inherit",
			...options,
		});
		child.on("error", reject);
		child.on("close", (code) => {
			resolveExit(typeof code === "number" ? code : 1);
		});
	});
}

async function main() {
	const args = parseArgs(process.argv.slice(2));

	if (!args.skipBuild) {
		console.log(`[dogfood] Building checkout at ${repoRoot}`);
		const buildCode = await runCommand(npmBinary, ["run", "build"], { cwd: repoRoot, env: process.env });
		if (buildCode !== 0) {
			process.exit(buildCode);
		}
	}

	const cliEntrypoint = resolve(repoRoot, "dist/cli.js");
	const launchArgs = [cliEntrypoint, "--port", args.port];
	if (args.noOpen) {
		launchArgs.push("--no-open");
	}

	console.log(`[dogfood] Launching ${cliEntrypoint}`);
	console.log(`[dogfood] Target project: ${args.project}`);
	console.log(`[dogfood] Runtime port: ${args.port}`);

	const exitCode = await runCommand(nodeBinary, launchArgs, {
		cwd: args.project,
		env: process.env,
	});
	process.exit(exitCode);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[dogfood] ${message}`);
	process.exit(1);
});
