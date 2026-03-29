import { promisify } from "node:util";

import { beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
	execFile: vi.fn(),
	execFilePromise: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFile: Object.assign(childProcessMocks.execFile, {
		[promisify.custom]: childProcessMocks.execFilePromise,
	}),
}));

import { runGit } from "../../src/workspace/git-utils";

function createExecError(options: {
	code: string | number;
	stdout?: string;
	stderr?: string;
	message?: string;
}): Error & { code: string | number; stdout: string; stderr: string } {
	const error = new Error(options.message ?? "git failed") as Error & {
		code: string | number;
		stdout: string;
		stderr: string;
	};
	error.code = options.code;
	error.stdout = options.stdout ?? "";
	error.stderr = options.stderr ?? "";
	return error;
}

describe("runGit", () => {
	beforeEach(() => {
		childProcessMocks.execFile.mockReset();
		childProcessMocks.execFilePromise.mockReset();
	});

	it("preserves raw stdout on exit code 1 when trimStdout is false", async () => {
		const diffOutput = "diff --git a/file b/file\n";
		childProcessMocks.execFilePromise.mockRejectedValueOnce(
			createExecError({
				code: 1,
				stdout: diffOutput,
				stderr: "",
			}),
		);

		const result = await runGit("/repo", ["diff", "--binary", "HEAD", "--"], { trimStdout: false });

		expect(result.ok).toBe(false);
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe(diffOutput);
	});

	it("does not classify non-process failures as git exit code 1", async () => {
		childProcessMocks.execFilePromise.mockRejectedValueOnce(
			createExecError({
				code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
				stdout: "partial-output",
				stderr: "",
				message: "stdout maxBuffer length exceeded",
			}),
		);

		const result = await runGit("/repo", ["diff", "--binary", "HEAD", "--"], { trimStdout: false });

		expect(result.ok).toBe(false);
		expect(result.exitCode).toBe(-1);
		expect(result.stdout).toBe("partial-output");
	});
});
