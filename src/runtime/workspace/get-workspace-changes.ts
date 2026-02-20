import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
	RuntimeWorkspaceChangesResponse,
	RuntimeWorkspaceFileChange,
	RuntimeWorkspaceFileStatus,
} from "../api-contract.js";

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

interface NameStatusEntry {
	path: string;
	status: RuntimeWorkspaceFileStatus;
	previousPath?: string;
}

interface DiffStat {
	additions: number;
	deletions: number;
}

function mapNameStatus(code: string): RuntimeWorkspaceFileStatus {
	const kind = code.charAt(0);
	if (kind === "M") return "modified";
	if (kind === "A") return "added";
	if (kind === "D") return "deleted";
	if (kind === "R") return "renamed";
	if (kind === "C") return "copied";
	return "unknown";
}

function toLineCount(text: string): number {
	if (!text) {
		return 0;
	}
	return text.split("\n").length;
}

function parseTrackedChanges(output: string): NameStatusEntry[] {
	const entries: NameStatusEntry[] = [];
	const lines = output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	for (const line of lines) {
		const parts = line.split("\t");
		const statusCode = parts[0];
		const status = mapNameStatus(statusCode);

		if ((status === "renamed" || status === "copied") && parts.length >= 3) {
			const previousPath = parts[1];
			const path = parts[2];
			if (path) {
				entries.push({
					path,
					previousPath: previousPath || undefined,
					status,
				});
			}
			continue;
		}

		const path = parts[1];
		if (path) {
			entries.push({
				path,
				status,
			});
		}
	}

	return entries;
}

async function runGit(args: string[], cwd: string): Promise<string> {
	try {
		const { stdout } = await execFileAsync("git", args, {
			cwd,
			encoding: "utf8",
			maxBuffer: GIT_MAX_BUFFER_BYTES,
		});
		return String(stdout);
	} catch (error) {
		const message =
			typeof error === "object" && error !== null && "stderr" in error
				? String((error as { stderr?: unknown }).stderr ?? "").trim()
				: "";
		if (message) {
			throw new Error(message);
		}
		throw error;
	}
}

async function readHeadFile(repoRoot: string, path: string): Promise<string | null> {
	try {
		return await runGit(["show", `HEAD:${path}`], repoRoot);
	} catch {
		return null;
	}
}

async function readWorkingTreeFile(repoRoot: string, path: string): Promise<string | null> {
	try {
		return await readFile(join(repoRoot, path), "utf8");
	} catch {
		return null;
	}
}

function fallbackStats(oldText: string | null, newText: string | null): DiffStat {
	if (oldText == null && newText == null) {
		return { additions: 0, deletions: 0 };
	}
	if (oldText == null) {
		return { additions: toLineCount(newText ?? ""), deletions: 0 };
	}
	if (newText == null) {
		return { additions: 0, deletions: toLineCount(oldText) };
	}

	const oldLines = toLineCount(oldText);
	const newLines = toLineCount(newText);
	return {
		additions: Math.max(newLines - oldLines, 0),
		deletions: Math.max(oldLines - newLines, 0),
	};
}

async function readDiffStat(repoRoot: string, path: string): Promise<DiffStat | null> {
	try {
		const output = await runGit(["diff", "--numstat", "HEAD", "--", path], repoRoot);
		const firstLine = output
			.split("\n")
			.map((line) => line.trim())
			.find(Boolean);
		if (!firstLine) {
			return null;
		}
		const [addedRaw, deletedRaw] = firstLine.split("\t");
		const additions = Number.parseInt(addedRaw ?? "", 10);
		const deletions = Number.parseInt(deletedRaw ?? "", 10);
		return {
			additions: Number.isFinite(additions) ? additions : 0,
			deletions: Number.isFinite(deletions) ? deletions : 0,
		};
	} catch {
		return null;
	}
}

async function buildFileChange(repoRoot: string, entry: NameStatusEntry): Promise<RuntimeWorkspaceFileChange> {
	const basePath = entry.previousPath ?? entry.path;
	const oldText =
		entry.status === "added" || entry.status === "untracked" ? null : await readHeadFile(repoRoot, basePath);
	const newText = entry.status === "deleted" ? null : await readWorkingTreeFile(repoRoot, entry.path);
	const stats =
		entry.status === "untracked"
			? { additions: toLineCount(newText ?? ""), deletions: 0 }
			: ((await readDiffStat(repoRoot, entry.path)) ?? fallbackStats(oldText, newText));

	return {
		path: entry.path,
		previousPath: entry.previousPath,
		status: entry.status,
		additions: stats.additions,
		deletions: stats.deletions,
		oldText,
		newText,
	};
}

export async function getWorkspaceChanges(cwd: string): Promise<RuntimeWorkspaceChangesResponse> {
	const repoRoot = (await runGit(["rev-parse", "--show-toplevel"], cwd)).trim();
	if (!repoRoot) {
		throw new Error("Could not resolve git repository root.");
	}

	const trackedChanges = parseTrackedChanges(await runGit(["diff", "--name-status", "HEAD", "--"], repoRoot));
	const untrackedPaths = (await runGit(["ls-files", "--others", "--exclude-standard"], repoRoot))
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	const trackedPaths = new Set(trackedChanges.map((entry) => entry.path));
	const allChanges: NameStatusEntry[] = [
		...trackedChanges,
		...untrackedPaths
			.filter((path) => !trackedPaths.has(path))
			.map((path) => ({
				path,
				status: "untracked" as const,
			})),
	];

	const files = await Promise.all(allChanges.map((entry) => buildFileChange(repoRoot, entry)));
	files.sort((left, right) => left.path.localeCompare(right.path));

	return {
		repoRoot,
		generatedAt: Date.now(),
		files,
	};
}
