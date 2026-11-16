import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerTaskCommand } from "../../src/commands/task";

const sendTaskSessionInput = vi.fn();
const projectsAdd = vi.fn();

vi.mock("@trpc/client", () => ({
	createTRPCProxyClient: vi.fn(() => ({
		projects: {
			add: {
				mutate: projectsAdd,
			},
		},
		runtime: {
			sendTaskSessionInput: {
				mutate: sendTaskSessionInput,
			},
		},
	})),
	httpBatchLink: vi.fn((input: unknown) => input),
}));

vi.mock("../../src/state/workspace-state", () => ({
	loadWorkspaceContext: vi.fn(async (repoPath: string) => ({
		repoPath,
		workspaceId: "workspace-1",
		statePath: `${repoPath}/.cline/kanban/workspaces/workspace-1`,
		git: {
			currentBranch: "main",
			defaultBranch: "main",
			branches: ["main"],
		},
	})),
	mutateWorkspaceState: vi.fn(),
}));

function createProgram(): Command {
	const program = new Command();
	program.exitOverride();
	program.configureOutput({
		writeErr: () => {},
		writeOut: () => {},
	});
	registerTaskCommand(program);
	return program;
}

describe("task command", () => {
	let stdout = "";
	let originalWrite: typeof process.stdout.write;

	beforeEach(() => {
		stdout = "";
		originalWrite = process.stdout.write;
		process.stdout.write = ((chunk: string | Uint8Array) => {
			stdout += chunk.toString();
			return true;
		}) as typeof process.stdout.write;
		projectsAdd.mockResolvedValue({
			ok: true,
			project: {
				id: "workspace-1",
			},
		});
		sendTaskSessionInput.mockResolvedValue({
			ok: true,
			summary: {
				agentId: "claude",
				state: "running",
			},
		});
	});

	afterEach(() => {
		process.stdout.write = originalWrite;
		vi.clearAllMocks();
	});

	it("submits terminal task input with a carriage return", async () => {
		await createProgram().parseAsync(
			["task", "send", "--task-id", "task-1", "--text", "Continue", "--project-path", "/repo"],
			{ from: "user" },
		);

		expect(sendTaskSessionInput).toHaveBeenCalledTimes(2);
		expect(sendTaskSessionInput).toHaveBeenNthCalledWith(1, {
			appendNewline: false,
			taskId: "task-1",
			text: "Continue",
		});
		expect(sendTaskSessionInput).toHaveBeenNthCalledWith(2, {
			appendNewline: false,
			taskId: "task-1",
			text: "\r",
		});
		expect(JSON.parse(stdout)).toMatchObject({
			ok: true,
			submitted: true,
			taskId: "task-1",
		});
	});

	it("can type terminal task input without submitting", async () => {
		await createProgram().parseAsync(
			["task", "send", "--task-id", "task-1", "--text", "Continue", "--project-path", "/repo", "--no-submit"],
			{ from: "user" },
		);

		expect(sendTaskSessionInput).toHaveBeenCalledTimes(1);
		expect(sendTaskSessionInput).toHaveBeenCalledWith({
			appendNewline: false,
			taskId: "task-1",
			text: "Continue",
		});
		expect(JSON.parse(stdout)).toMatchObject({
			ok: true,
			submitted: false,
			taskId: "task-1",
		});
	});

	it("does not send a carriage return after Cline task input", async () => {
		sendTaskSessionInput.mockResolvedValue({
			ok: true,
			summary: {
				agentId: "cline",
				state: "running",
			},
		});

		await createProgram().parseAsync(
			["task", "send", "--task-id", "task-1", "--text", "Continue", "--project-path", "/repo"],
			{ from: "user" },
		);

		expect(sendTaskSessionInput).toHaveBeenCalledTimes(1);
		expect(sendTaskSessionInput).toHaveBeenCalledWith({
			appendNewline: false,
			taskId: "task-1",
			text: "Continue",
		});
		expect(JSON.parse(stdout)).toMatchObject({
			ok: true,
			submitted: true,
			taskId: "task-1",
		});
	});

	it("trims one trailing newline from stdin input", async () => {
		const originalIsTty = process.stdin.isTTY;
		const originalAsyncIterator = process.stdin[Symbol.asyncIterator];
		Object.defineProperty(process.stdin, "isTTY", {
			configurable: true,
			value: false,
		});
		process.stdin[Symbol.asyncIterator] = async function* () {
			yield Buffer.from("Continue\n");
		};

		try {
			await createProgram().parseAsync(["task", "send", "--task-id", "task-1", "--project-path", "/repo"], {
				from: "user",
			});
		} finally {
			Object.defineProperty(process.stdin, "isTTY", {
				configurable: true,
				value: originalIsTty,
			});
			process.stdin[Symbol.asyncIterator] = originalAsyncIterator;
		}

		expect(sendTaskSessionInput).toHaveBeenNthCalledWith(1, {
			appendNewline: false,
			taskId: "task-1",
			text: "Continue",
		});
		expect(sendTaskSessionInput).toHaveBeenNthCalledWith(2, {
			appendNewline: false,
			taskId: "task-1",
			text: "\r",
		});
	});

	it("rejects an empty text option", async () => {
		await createProgram().parseAsync(
			["task", "send", "--task-id", "task-1", "--text", "", "--project-path", "/repo"],
			{ from: "user" },
		);

		expect(sendTaskSessionInput).not.toHaveBeenCalled();
		expect(JSON.parse(stdout)).toMatchObject({
			ok: false,
			error: expect.stringContaining("--text value cannot be empty"),
		});
		expect(process.exitCode).toBe(1);
		process.exitCode = undefined;
	});
});
