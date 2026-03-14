import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { RuntimeTaskTurnCheckpoint } from "../core/api-contract.js";
import { createGitProcessEnv } from "../core/git-process-env.js";

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const CHECKPOINT_AUTHOR_NAME = "kanban-checkpoint";
const CHECKPOINT_AUTHOR_EMAIL = "kanban-checkpoint@local";

interface RunGitOptions {
	trimStdout?: boolean;
	env?: NodeJS.ProcessEnv;
}

async function runGit(cwd: string, args: string[], options: RunGitOptions = {}): Promise<string> {
	const { stdout } = await execFileAsync("git", args, {
		cwd,
		encoding: "utf8",
		maxBuffer: GIT_MAX_BUFFER_BYTES,
		env: options.env ?? createGitProcessEnv(),
	});
	const text = String(stdout ?? "");
	return options.trimStdout === false ? text : text.trim();
}

async function tryRunGit(cwd: string, args: string[], options: RunGitOptions = {}): Promise<string | null> {
	try {
		return await runGit(cwd, args, options);
	} catch {
		return null;
	}
}

function encodeRefSegment(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

function buildCheckpointRef(taskId: string, turn: number): string {
	return `refs/kanban/checkpoints/${encodeRefSegment(taskId)}/turn/${turn}`;
}

async function createWorkingTreeCheckpointCommit(repoRoot: string, turn: number, taskId: string): Promise<string> {
	const tempDir = await mkdtemp(join(tmpdir(), "kanban-checkpoint-"));
	const tempIndexPath = join(tempDir, "index");

	const gitEnv: NodeJS.ProcessEnv = {
		...createGitProcessEnv(),
		GIT_INDEX_FILE: tempIndexPath,
		GIT_AUTHOR_NAME: CHECKPOINT_AUTHOR_NAME,
		GIT_AUTHOR_EMAIL: CHECKPOINT_AUTHOR_EMAIL,
		GIT_COMMITTER_NAME: CHECKPOINT_AUTHOR_NAME,
		GIT_COMMITTER_EMAIL: CHECKPOINT_AUTHOR_EMAIL,
	};

	try {
		const headCommit = await tryRunGit(repoRoot, ["rev-parse", "--verify", "HEAD"], {
			env: gitEnv,
		});
		if (headCommit) {
			await runGit(repoRoot, ["read-tree", headCommit], { env: gitEnv });
		} else {
			await runGit(repoRoot, ["read-tree", "--empty"], { env: gitEnv });
		}

		await runGit(repoRoot, ["add", "-A", "--", "."], { env: gitEnv });
		const treeOid = await runGit(repoRoot, ["write-tree"], { env: gitEnv });

		const commitMessage = `kanban checkpoint task:${taskId} turn:${turn}`;
		const commitArgs = ["commit-tree", treeOid, "-m", commitMessage];
		if (headCommit) {
			commitArgs.push("-p", headCommit);
		}

		return await runGit(repoRoot, commitArgs, {
			env: gitEnv,
		});
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

export async function captureTaskTurnCheckpoint(input: {
	cwd: string;
	taskId: string;
	turn: number;
}): Promise<RuntimeTaskTurnCheckpoint> {
	const repoRoot = await runGit(input.cwd, ["rev-parse", "--show-toplevel"]);
	const commit = await createWorkingTreeCheckpointCommit(repoRoot, input.turn, input.taskId);
	const ref = buildCheckpointRef(input.taskId, input.turn);
	await runGit(repoRoot, ["update-ref", ref, commit]);
	return {
		turn: input.turn,
		ref,
		commit,
		createdAt: Date.now(),
	};
}

export async function deleteTaskTurnCheckpointRef(input: { cwd: string; ref: string }): Promise<void> {
	const repoRoot = await runGit(input.cwd, ["rev-parse", "--show-toplevel"]);
	await tryRunGit(repoRoot, ["update-ref", "-d", input.ref]);
}
