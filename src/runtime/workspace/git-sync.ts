import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
	RuntimeGitCheckoutResponse,
	RuntimeGitSyncAction,
	RuntimeGitSyncResponse,
	RuntimeGitSyncSummary,
} from "../api-contract.js";

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

interface GitCommandResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	output: string;
	error: string | null;
}

function countLines(text: string): number {
	if (!text) {
		return 0;
	}
	return text.split("\n").length;
}

function parseNumstatTotals(output: string): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;

	for (const rawLine of output.split("\n")) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}
		const [addedRaw, deletedRaw] = line.split("\t");
		const added = Number.parseInt(addedRaw ?? "", 10);
		const deleted = Number.parseInt(deletedRaw ?? "", 10);
		if (Number.isFinite(added)) {
			additions += added;
		}
		if (Number.isFinite(deleted)) {
			deletions += deleted;
		}
	}

	return { additions, deletions };
}

function parseAheadBehindCounts(output: string): { aheadCount: number; behindCount: number } {
	const [aheadRaw, behindRaw] = output.trim().split(/\s+/, 2);
	const ahead = Number.parseInt(aheadRaw ?? "", 10);
	const behind = Number.parseInt(behindRaw ?? "", 10);
	return {
		aheadCount: Number.isFinite(ahead) ? ahead : 0,
		behindCount: Number.isFinite(behind) ? behind : 0,
	};
}

async function runGitCommand(cwd: string, args: string[]): Promise<GitCommandResult> {
	try {
		const { stdout, stderr } = await execFileAsync("git", args, {
			cwd,
			encoding: "utf8",
			maxBuffer: GIT_MAX_BUFFER_BYTES,
		});
		const normalizedStdout = String(stdout ?? "").trim();
		const normalizedStderr = String(stderr ?? "").trim();
		return {
			ok: true,
			stdout: normalizedStdout,
			stderr: normalizedStderr,
			output: [normalizedStdout, normalizedStderr].filter(Boolean).join("\n"),
			error: null,
		};
	} catch (error) {
		const candidate = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
		const stdout = String(candidate.stdout ?? "").trim();
		const stderr = String(candidate.stderr ?? "").trim();
		const message = String(candidate.message ?? "").trim();
		const resolvedError = stderr || message || "Git command failed.";
		return {
			ok: false,
			stdout,
			stderr,
			output: [stdout, stderr].filter(Boolean).join("\n"),
			error: resolvedError,
		};
	}
}

async function tryResolveRepoRoot(cwd: string): Promise<string | null> {
	const result = await runGitCommand(cwd, ["rev-parse", "--show-toplevel"]);
	if (!result.ok || !result.stdout) {
		return null;
	}
	return result.stdout;
}

async function countUntrackedAdditions(repoRoot: string, untrackedPaths: string[]): Promise<number> {
	const counts = await Promise.all(
		untrackedPaths.map(async (relativePath) => {
			try {
				const contents = await readFile(join(repoRoot, relativePath), "utf8");
				return countLines(contents);
			} catch {
				return 0;
			}
		}),
	);
	return counts.reduce((total, value) => total + value, 0);
}

async function hasGitRef(repoRoot: string, ref: string): Promise<boolean> {
	const result = await runGitCommand(repoRoot, ["show-ref", "--verify", "--quiet", ref]);
	return result.ok;
}

function createNoGitSummary(): RuntimeGitSyncSummary {
	return {
		hasGit: false,
		currentBranch: null,
		upstreamBranch: null,
		changedFiles: 0,
		additions: 0,
		deletions: 0,
		aheadCount: 0,
		behindCount: 0,
	};
}

export async function getGitSyncSummary(cwd: string): Promise<RuntimeGitSyncSummary> {
	const repoRoot = await tryResolveRepoRoot(cwd);
	if (!repoRoot) {
		return createNoGitSummary();
	}

	const [currentBranchResult, statusResult, diffResult, upstreamResult] = await Promise.all([
		runGitCommand(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
		runGitCommand(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"]),
		runGitCommand(repoRoot, ["diff", "--numstat", "HEAD", "--"]),
		runGitCommand(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
	]);

	const currentBranch = currentBranchResult.ok && currentBranchResult.stdout ? currentBranchResult.stdout : null;
	const upstreamBranch = upstreamResult.ok && upstreamResult.stdout ? upstreamResult.stdout : null;

	let aheadCount = 0;
	let behindCount = 0;
	if (upstreamBranch) {
		const aheadBehindResult = await runGitCommand(repoRoot, [
			"rev-list",
			"--left-right",
			"--count",
			`HEAD...${upstreamBranch}`,
		]);
		if (aheadBehindResult.ok) {
			const parsed = parseAheadBehindCounts(aheadBehindResult.stdout);
			aheadCount = parsed.aheadCount;
			behindCount = parsed.behindCount;
		}
	}

	const statusLines = statusResult.ok
		? statusResult.stdout
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean)
		: [];
	const changedFiles = statusLines.length;
	const untrackedPaths = statusLines
		.filter((line) => line.startsWith("?? "))
		.map((line) => line.slice(3).trim())
		.filter(Boolean);

	const trackedTotals = diffResult.ok ? parseNumstatTotals(diffResult.stdout) : { additions: 0, deletions: 0 };
	const untrackedAdditions = await countUntrackedAdditions(repoRoot, untrackedPaths);

	return {
		hasGit: true,
		currentBranch,
		upstreamBranch,
		changedFiles,
		additions: trackedTotals.additions + untrackedAdditions,
		deletions: trackedTotals.deletions,
		aheadCount,
		behindCount,
	};
}

export async function runGitSyncAction(options: {
	cwd: string;
	action: RuntimeGitSyncAction;
}): Promise<RuntimeGitSyncResponse> {
	const initialSummary = await getGitSyncSummary(options.cwd);
	if (!initialSummary.hasGit) {
		return {
			ok: false,
			action: options.action,
			summary: initialSummary,
			output: "",
			error: "No git repository detected for this workspace.",
		};
	}

	if (options.action === "pull" && initialSummary.changedFiles > 0) {
		return {
			ok: false,
			action: options.action,
			summary: initialSummary,
			output: "",
			error: "Pull failed: working tree has local changes. Commit, stash, or discard changes first.",
		};
	}

	const argsByAction: Record<RuntimeGitSyncAction, string[]> = {
		fetch: ["fetch", "--all", "--prune"],
		pull: ["pull", "--ff-only"],
		push: ["push"],
	};
	const commandResult = await runGitCommand(options.cwd, argsByAction[options.action]);
	const nextSummary = await getGitSyncSummary(options.cwd);

	if (!commandResult.ok) {
		return {
			ok: false,
			action: options.action,
			summary: nextSummary,
			output: commandResult.output,
			error: commandResult.error ?? "Git command failed.",
		};
	}

	return {
		ok: true,
		action: options.action,
		summary: nextSummary,
		output: commandResult.output,
	};
}

export async function runGitCheckoutAction(options: {
	cwd: string;
	branch: string;
}): Promise<RuntimeGitCheckoutResponse> {
	const requestedBranch = options.branch.trim();
	const initialSummary = await getGitSyncSummary(options.cwd);
	if (!initialSummary.hasGit) {
		return {
			ok: false,
			branch: requestedBranch,
			summary: initialSummary,
			output: "",
			error: "No git repository detected for this workspace.",
		};
	}

	if (!requestedBranch) {
		return {
			ok: false,
			branch: requestedBranch,
			summary: initialSummary,
			output: "",
			error: "Branch name cannot be empty.",
		};
	}

	if (initialSummary.currentBranch === requestedBranch) {
		return {
			ok: true,
			branch: requestedBranch,
			summary: initialSummary,
			output: `Already on '${requestedBranch}'.`,
		};
	}

	const repoRoot = await tryResolveRepoRoot(options.cwd);
	if (!repoRoot) {
		return {
			ok: false,
			branch: requestedBranch,
			summary: initialSummary,
			output: "",
			error: "No git repository detected for this workspace.",
		};
	}

	const hasLocalBranch = await hasGitRef(repoRoot, `refs/heads/${requestedBranch}`);
	const commandResult = hasLocalBranch
		? await runGitCommand(repoRoot, ["switch", requestedBranch])
		: (await hasGitRef(repoRoot, `refs/remotes/origin/${requestedBranch}`))
			? await runGitCommand(repoRoot, ["switch", "--track", `origin/${requestedBranch}`])
			: await runGitCommand(repoRoot, ["switch", requestedBranch]);
	const nextSummary = await getGitSyncSummary(repoRoot);

	if (!commandResult.ok) {
		return {
			ok: false,
			branch: requestedBranch,
			summary: nextSummary,
			output: commandResult.output,
			error: commandResult.error ?? "Git branch switch failed.",
		};
	}

	return {
		ok: true,
		branch: requestedBranch,
		summary: nextSummary,
		output: commandResult.output,
	};
}
