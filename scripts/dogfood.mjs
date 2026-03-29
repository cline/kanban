#!/usr/bin/env node

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const nodeBinary = process.execPath;
const npmBinary = process.platform === "win32" ? "npm.cmd" : "npm";

function printHelp() {
	console.log(
		"Usage: npm run dogfood [--skip-shutdown-cleanup] -- [--project <path>] [--port <number|auto>] [--no-open] [--skip-build] [--skip-shutdown-cleanup]",
	);
}

function readNpmBooleanFlag(name) {
	const value = process.env[`npm_config_${name}`];
	if (typeof value !== "string") {
		return false;
	}
	const normalized = value.trim().toLowerCase();
	if (normalized === "" || normalized === "true" || normalized === "1") {
		return true;
	}
	return !["false", "0", "no", "off"].includes(normalized);
}

function parseArgs(argv) {
	let project = "";
	let port = "auto";
	let noOpen = false;
	let skipBuild = false;
	let skipShutdownCleanup = readNpmBooleanFlag("skip_shutdown_cleanup");

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
		if (arg === "--skip-shutdown-cleanup") {
			skipShutdownCleanup = true;
			continue;
		}
		throw new Error(`Unknown option: ${arg}`);
	}

	return {
		project: project.trim() ? resolve(project.trim()) : null,
		port: port.trim() || "auto",
		noOpen,
		skipBuild,
		skipShutdownCleanup,
	};
}

function runCommand(command, args, spawnOptions = {}) {
	return new Promise((resolveExit, reject) => {
		const child = spawn(command, args, {
			stdio: "inherit",
			...spawnOptions,
		});

		child.on("error", (err) => {
			reject(err);
		});
		child.on("close", (code) => {
			resolveExit(typeof code === "number" ? code : 1);
		});
	});
}

function runRuntimeCommand(command, args, spawnOptions = {}) {
	return new Promise((resolveExit, reject) => {
		const child = spawn(command, args, {
			stdio: "inherit",
			detached: process.platform !== "win32",
			...spawnOptions,
		});

		// Dogfood used to rely on the shell/npm process group behavior, but under
		// `npm run dogfood` Ctrl+C could reach the runtime twice: once directly
		// from the terminal group and again through npm wrapper shutdown. That
		// second SIGINT was enough to make Kanban force-exit before shutdown
		// cleanup finished, which left in_progress/review cards behind. Running
		// the runtime in its own process group and forwarding exactly one graceful
		// shutdown signal from this wrapper keeps shutdown deterministic while
		// still giving us a timed SIGKILL fallback if the child hangs.
		const sendSignalToChild = (signal) => {
			if (child.exitCode !== null || child.pid == null) {
				return;
			}
			if (process.platform !== "win32") {
				try {
					process.kill(-child.pid, signal);
					return;
				} catch (error) {
					if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") {
						return;
					}
				}
			}
			child.kill(signal);
		};

		let shutdownStarted = false;
		let forceKillTimer = null;
		const requestShutdown = (signal) => {
			if (shutdownStarted) {
				return;
			}
			shutdownStarted = true;
			sendSignalToChild(signal);
			forceKillTimer = setTimeout(() => {
				sendSignalToChild("SIGKILL");
			}, 10_000);
		};

		const onSigint = () => {
			requestShutdown("SIGINT");
		};
		const onSigterm = () => {
			requestShutdown("SIGTERM");
		};
		const onSighup = () => {
			requestShutdown("SIGTERM");
		};

		process.on("SIGINT", onSigint);
		process.on("SIGTERM", onSigterm);
		process.on("SIGHUP", onSighup);

		const cleanup = () => {
			if (forceKillTimer !== null) {
				clearTimeout(forceKillTimer);
				forceKillTimer = null;
			}
			process.off("SIGINT", onSigint);
			process.off("SIGTERM", onSigterm);
			process.off("SIGHUP", onSighup);
		};

		child.on("error", (err) => {
			cleanup();
			reject(err);
		});
		child.on("close", (code) => {
			cleanup();
			resolveExit(typeof code === "number" ? code : 1);
		});
	});
}

function stripNodeModulesBinFromPath(pathValue) {
	if (typeof pathValue !== "string" || pathValue.length === 0) {
		return pathValue;
	}
	// `npm run dogfood` prepends this repo's node_modules/.bin, which can shadow
	// globally installed agent CLIs (codex/claude/etc) that Kanban should exercise.
	// This is mostly a dogfood/dev-launch issue; normal installed CLI usage does
	// not inject repo-local node_modules/.bin ahead of user PATH entries.
	return pathValue
		.split(delimiter)
		.filter((entry) => {
			const normalized = entry
				.trim()
				.replaceAll("\\", "/")
				.replace(/\/+$/u, "")
				.toLowerCase();
			return !normalized.endsWith("/node_modules/.bin");
		})
		.join(delimiter);
}

function buildDogfoodRuntimeEnv(baseEnv) {
	const runtimeEnv = { ...baseEnv };
	for (const key of Object.keys(runtimeEnv)) {
		if (key.toUpperCase() !== "PATH") {
			continue;
		}
		runtimeEnv[key] = stripNodeModulesBinFromPath(runtimeEnv[key]);
		break;
	}
	return runtimeEnv;
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
	const launchArgs = ["--port", args.port];
	if (args.skipShutdownCleanup) {
		launchArgs.push("--skip-shutdown-cleanup");
	}
	if (args.noOpen) {
		launchArgs.push("--no-open");
	}
	const launchCwd = args.project ?? tmpdir();

	console.log(`[dogfood] Launching ${cliEntrypoint}`);
	if (args.project) {
		console.log(`[dogfood] Target project: ${args.project}`);
	} else {
		console.log(`[dogfood] No --project provided; launching from non-git cwd ${launchCwd}`);
		console.log("[dogfood] Kanban will open the first indexed project if one exists.");
	}
	console.log(`[dogfood] Runtime port: ${args.port}`);

	const exitCode = await runRuntimeCommand(nodeBinary, [cliEntrypoint, ...launchArgs], {
		cwd: launchCwd,
		env: buildDogfoodRuntimeEnv(process.env),
	});
	process.exit(exitCode);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[dogfood] ${message}`);
	process.exit(1);
});
