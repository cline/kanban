import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { piReadinessInternals, probePiReadiness } from "../../../src/terminal/pi-readiness";

class FakeChildProcess extends EventEmitter {
	readonly stdin = new PassThrough();
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();

	kill(_signal?: NodeJS.Signals | number): boolean {
		this.emit("exit", null, "SIGTERM");
		return true;
	}
}

describe("probePiReadiness", () => {
	it("treats any prompt failure response as not ready even if Pi later emits success", async () => {
		const child = new FakeChildProcess();
		const spawnMock = vi.fn(() => child as never);

		const probePromise = probePiReadiness(
			{
				binary: "pi",
				args: [],
				cwd: "/tmp/worktree",
				prompt: "Reply with READY only.",
			},
			{ spawn: spawnMock },
		);

		child.stdout.write(
			`${JSON.stringify({
				id: "kanban-pi-readiness",
				type: "response",
				command: "prompt",
				success: false,
				error: "No API key found for openai-codex.\n\nUse /login or set an API key environment variable.",
			})}\n`,
		);
		child.stdout.write(
			`${JSON.stringify({
				id: "kanban-pi-readiness",
				type: "response",
				command: "prompt",
				success: true,
			})}\n`,
		);
		child.emit("exit", 0, null);

		await expect(probePromise).resolves.toEqual({
			status: "not_ready",
			reason: "missing_api_key",
			message:
				"Pi is not ready: No API key found for openai-codex. Use /login or set an API key environment variable.",
			rawMessage: "No API key found for openai-codex. Use /login or set an API key environment variable.",
		});
		expect(spawnMock).toHaveBeenCalledWith(
			"pi",
			["--mode", "rpc", "--no-session"],
			expect.objectContaining({ cwd: "/tmp/worktree" }),
		);
	});

	it("maps stderr startup failures to not ready when Pi exits before a prompt response", async () => {
		const child = new FakeChildProcess();
		const spawnMock = vi.fn(() => child as never);

		const probePromise = probePiReadiness(
			{
				binary: "pi",
				args: ["--model", "definitely-not-a-model"],
				cwd: "/tmp/worktree",
			},
			{ spawn: spawnMock },
		);

		child.stderr.write(
			'Error: Model "definitely-not-a-model" not found. Use --list-models to see available models.\n',
		);
		child.emit("exit", 1, null);

		await expect(probePromise).resolves.toEqual({
			status: "not_ready",
			reason: "model_not_found",
			message:
				'Pi is not ready: Error: Model "definitely-not-a-model" not found. Use --list-models to see available models.',
			rawMessage: 'Error: Model "definitely-not-a-model" not found. Use --list-models to see available models.',
		});
	});

	it("filters session and mode flags before spawning the Pi rpc readiness probe", () => {
		expect(
			piReadinessInternals.buildPiReadinessProbeArgs([
				"--mode",
				"json",
				"--session-dir",
				"/tmp/pi-session",
				"--continue",
				"session-id",
				"--model",
				"gpt-5.4",
				"--provider=openai-codex",
			]),
		).toEqual(["--mode", "rpc", "--no-session", "--model", "gpt-5.4", "--provider=openai-codex"]);
	});
});
