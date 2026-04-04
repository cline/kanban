/**
 * Starts both the runtime server and Vite web UI dev server on an
 * automatically-selected free port. Use via `npm run dev:full` or the
 * VS Code "Dev (Full Stack)" launch config.
 */
import { createServer, connect } from "node:net";
import { spawn } from "node:child_process";
import treeKill from "tree-kill";
import open from "open";

const isWindows = process.platform === "win32";

function findPort(start) {
	return new Promise((resolve) => {
		const srv = createServer();
		srv.listen(start, "127.0.0.1", () => {
			srv.close(() => resolve(start));
		});
		srv.on("error", () => resolve(findPort(start + 1)));
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

const port = await findPort(3484);
console.log(`\n  Runtime port: ${port}`);
console.log(`  Web UI:       http://127.0.0.1:4173\n`);

const env = { ...process.env, KANBAN_RUNTIME_PORT: String(port) };

const tsxBin = isWindows ? "node_modules/.bin/tsx.cmd" : "node_modules/.bin/tsx";
const runtime = spawn(tsxBin, ["watch", "src/cli.ts", "--port", String(port), "--no-open"], {
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
	await waitForPort(port);
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
	open("http://127.0.0.1:4173");
}, 2000);
