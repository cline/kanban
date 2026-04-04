/**
 * Integration test: Desktop agent can create tasks via inherited env vars.
 *
 * This test simulates the desktop app flow:
 *   1. Start the kanban runtime with an auth token (like Electron does)
 *   2. Spawn a child process that inherits KANBAN_RUNTIME_HOST, KANBAN_RUNTIME_PORT,
 *      and KANBAN_AUTH_TOKEN from process.env (like a PTY session would)
 *   3. That child runs `kanban task create --prompt "..." --project-path <path>`
 *   4. Verify the task appears on the board
 *
 * This is the VS Code-style env var propagation pattern — the same mechanism
 * that makes `code` CLI work from VS Code's integrated terminal.
 *
 * IMPORTANT: We use async `spawn` (not `spawnSync`) because the runtime
 * server runs in-process. `spawnSync` would deadlock — the child tries to
 * HTTP-connect to the parent, which is blocked waiting on the child.
 */

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { type RuntimeHandle, startRuntime } from "../../src/runtime-start";
import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

const requireFromHere = createRequire(import.meta.url);

function resolveTsxLoaderImportSpecifier(): string {
	return pathToFileURL(requireFromHere.resolve("tsx")).href;
}

function initGitRepository(path: string): void {
	const env = createGitTestEnv();
	const init = spawnSync("git", ["init"], { cwd: path, stdio: "ignore", env });
	if (init.status !== 0) throw new Error(`git init failed at ${path}`);
	const checkout = spawnSync("git", ["checkout", "-B", "main"], { cwd: path, stdio: "ignore", env });
	if (checkout.status !== 0) throw new Error(`git checkout failed at ${path}`);
	spawnSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: path, stdio: "ignore", env });
}

async function getAvailablePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((res, rej) => {
		server.once("error", rej);
		server.listen(0, "127.0.0.1", () => res());
	});
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : null;
	await new Promise<void>((res, rej) => {
		server.close((err) => (err ? rej(err) : res()));
	});
	if (!port) throw new Error("Could not allocate a test port.");
	return port;
}

/**
 * Run `kanban task create` in a child process with the given env vars.
 * Uses async `spawn` to avoid deadlocking with the in-process runtime server.
 */
function runTaskCreate(
	port: number,
	authToken: string | undefined,
	projectPath: string,
	prompt: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
	const cliEntryPath = resolve(process.cwd(), "src/cli.ts");
	return new Promise((res) => {
		const child = spawn(
			process.execPath,
			[
				"--import",
				resolveTsxLoaderImportSpecifier(),
				cliEntryPath,
				"task",
				"create",
				"--prompt",
				prompt,
				"--project-path",
				projectPath,
			],
			{
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					KANBAN_RUNTIME_HOST: "127.0.0.1",
					KANBAN_RUNTIME_PORT: String(port),
					...(authToken ? { KANBAN_AUTH_TOKEN: authToken } : {}),
				},
			},
		);

		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.once("exit", (exitCode) => {
			res({ stdout, stderr, exitCode });
		});

		// Safety timeout
		setTimeout(() => {
			child.kill("SIGKILL");
		}, 20_000);
	});
}

describe("desktop agent task create via env var propagation", { timeout: 60_000 }, () => {
	let runtime: RuntimeHandle | null = null;

	afterEach(async () => {
		if (runtime) {
			await runtime.shutdown({ skipSessionCleanup: true }).catch(() => {});
			runtime = null;
		}
		delete process.env.KANBAN_AUTH_TOKEN;
	});

	it("creates a task when KANBAN_AUTH_TOKEN is set in the child env", async () => {
		const { path: tempDir } = createTempDir("desktop-agent-task-create");
		initGitRepository(tempDir);

		const port = await getAvailablePort();
		const authToken = `test-desktop-auth-${Date.now()}`;

		// Start the runtime with auth — exactly what the desktop app does.
		runtime = await startRuntime({
			host: "127.0.0.1",
			port,
			authToken,
			callbacks: { warn: () => {} },
			isLocal: true,
		});

		// Verify runtime is up.
		const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`, {
			headers: { Authorization: `Bearer ${authToken}` },
		});
		expect(healthResponse.ok).toBe(true);

		// Now simulate what the desktop agent does: run `kanban task create`
		// in a child process with env vars inherited from the runtime.
		const result = await runTaskCreate(port, authToken, tempDir, "Test task from desktop agent");

		expect(result.exitCode, `task create should exit 0.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);

		// Verify the output contains the created task info.
		expect(result.stdout).toContain("Test task from desktop agent");
	});

	it("task create fails without auth token when runtime requires auth", async () => {
		const { path: tempDir } = createTempDir("desktop-agent-no-auth");
		initGitRepository(tempDir);

		const port = await getAvailablePort();
		const authToken = `test-desktop-auth-${Date.now()}`;

		runtime = await startRuntime({
			host: "127.0.0.1",
			port,
			authToken,
			callbacks: { warn: () => {} },
			isLocal: true,
		});

		// Ensure no stale auth token from prior tests.
		delete process.env.KANBAN_AUTH_TOKEN;

		// Try without auth token — should fail.
		const result = await runTaskCreate(port, undefined, tempDir, "Should fail");

		expect(result.exitCode).not.toBe(0);
	});
});
