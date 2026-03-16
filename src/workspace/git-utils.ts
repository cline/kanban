import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createGitProcessEnv } from "../core/git-process-env.js";

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

interface GitCommandResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	output: string;
	error: string | null;
}

export interface RunGitOptions {
	trimStdout?: boolean;
	env?: NodeJS.ProcessEnv;
}

export async function runGit(cwd: string, args: string[], options: RunGitOptions = {}): Promise<GitCommandResult> {
	try {
		const { stdout, stderr } = await execFileAsync("git", args, {
			cwd,
			encoding: "utf8",
			maxBuffer: GIT_MAX_BUFFER_BYTES,
			env: options.env || createGitProcessEnv(),
		});
		const normalizedStdout = String(stdout ?? "").trim();
		const normalizedStderr = String(stderr ?? "").trim();
		return {
			ok: true,
			stdout: options.trimStdout === false ? stdout : normalizedStdout,
			stderr: normalizedStderr,
			output: [normalizedStdout, normalizedStderr].filter(Boolean).join("\n"),
			error: null,
		};
	} catch (error) {
		const candidate = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
		const stdout = String(candidate.stdout ?? "").trim();
		const stderr = String(candidate.stderr ?? "").trim();
		const message = String(candidate.message ?? "").trim();
		const command = `git ${args.join(" ")} failed`
		const errorMessage = `Failed to run Git Command: \n Command: \n ${command} \n ${stderr || message}`

		return {
			ok: false,
			stdout,
			stderr,
			output: [stdout, stderr].filter(Boolean).join("\n"),
			error: errorMessage,
		};
	}
}

export async function getGitStdout(args: string[], cwd: string, options: RunGitOptions = {}): Promise<string> {
	const result = await runGit(cwd, args, options)
	if(!result.ok) {
		throw new Error(result.error || result.stdout)
	}

	return result.stdout
}