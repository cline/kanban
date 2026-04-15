/**
 * Starts both the runtime server and Vite web UI dev server on an
 * automatically-selected free port. Use via `npm run dev:full` or the
 * VS Code "Dev (Full Stack)" launch config.
 */
import { createServer, connect } from "node:net";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import treeKill from "tree-kill";
import open from "open";

const isWindows = process.platform === "win32";

async function ensureDependenciesInstalled() {
	const lockIndicator = join(process.cwd(), "node_modules", ".package-lock.json");
	try {
		await access(lockIndicator);
	} catch {
		console.warn("node_modules not installed in this worktree. Running npm ci...");
		await run("npm", ["ci"]);
		await run("npm", ["--prefix", "web-ui", "ci"]);
	}
}

function run(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: "inherit", shell: isWindows });
		child.on("error", reject);
		child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
	});
}

function findPort(start, reserved = new Set()) {
	if (reserved.has(start)) {
		return findPort(start + 1, reserved);
	}
	return new Promise((resolve) => {
		const srv = createServer();
		srv.listen(start, "127.0.0.1", () => {
			srv.close(() => resolve(start));
		});
		srv.on("error", () => resolve(findPort(start + 1, reserved)));
	});
}

function waitForPort(port, timeout = 15000) {
	const start = Date.now();
	return new Promise((resolve, reject) => {
		function attempt() {
			const sock = connect(port, "127.0.0.1");
			sock.on("connect", () => {
				sock.destroy();
				resolve();
			});
			sock.on("error", () => {
				if (Date.now() - start > timeout) {
					reject(new Error(`Runtime did not start within ${timeout}ms`));
				} else {
					setTimeout(attempt, 200);
				}
			});
		}
		attempt();
	});
}

await ensureDependenciesInstalled();

const runtimePort = await findPort(3484);
const webUiPort = await findPort(4173, new Set([runtimePort]));
const requestedDevFullArgs = process.argv.slice(2);
const withShutdownCleanupFlag = "--with-shutdown-cleanup";
const requestedRuntimeArgs = requestedDevFullArgs.filter((arg) => arg !== withShutdownCleanupFlag);
const hasExplicitSkipCleanupArg = requestedRuntimeArgs.some((arg) => arg === "--skip-shutdown-cleanup");
const shouldDefaultSkipShutdownCleanup = !requestedDevFullArgs.includes(withShutdownCleanupFlag);
const runtimeCliArgs = [
	"--port",
	String(runtimePort),
	"--no-open",
	...(shouldDefaultSkipShutdownCleanup && !hasExplicitSkipCleanupArg ? ["--skip-shutdown-cleanup"] : []),
	...requestedRuntimeArgs,
];

console.log(`\n  Runtime port: ${runtimePort}`);
console.log(`  Web UI:       http://127.0.0.1:${webUiPort}\n`);

const env = {
	...process.env,
	KANBAN_RUNTIME_PORT: String(runtimePort),
	KANBAN_WEB_UI_PORT: String(webUiPort),
};

const tsxBin = isWindows ? "node_modules/.bin/tsx.cmd" : "node_modules/.bin/tsx";
const runtime = spawn(tsxBin, ["watch", "src/cli.ts", ...runtimeCliArgs], {
	env,
	stdio: "inherit",
});

let vite;
let exiting = false;

function cleanup(exitCode = 0) {
	if (exiting) return;
	exiting = true;
	if (runtime.pid) treeKill(runtime.pid);
	if (vite?.pid) treeKill(vite.pid);
	process.exit(exitCode);
}

process.on("SIGTERM", () => cleanup(0));
process.on("SIGINT", () => cleanup(0));
runtime.on("exit", () => cleanup(1));

// Wait for runtime to accept connections before starting Vite
try {
	await waitForPort(runtimePort);
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Failed to start runtime: ${message}`);
	cleanup(1);
}

vite = spawn("npm", ["run", "web:dev"], {
	env,
	stdio: "inherit",
	shell: isWindows,
});

vite.on("exit", () => cleanup(1));

// Auto-open browser after a short delay for Vite to start
setTimeout(() => {
	open(`http://127.0.0.1:${webUiPort}`);
}, 2000);
