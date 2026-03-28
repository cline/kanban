import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type {
	RuntimeWorkspaceChangesResponse,
	RuntimeWorkspaceFileChange,
	RuntimeWorkspaceFileStatus,
} from "../core/api-contract";
import { getGitStdout } from "./git-utils";

const WORKSPACE_CHANGES_CACHE_MAX_ENTRIES = 128;
const MAX_WORKSPACE_CHANGE_FILES = 250;
const MAX_WORKSPACE_CHANGE_TEXT_BYTES = 5_000_000;

interface WorkspaceChangesCacheEntry {
	stateKey: string;
	response: RuntimeWorkspaceChangesResponse;
	lastAccessedAt: number;
}

const workspaceChangesCacheByRepoRoot = new Map<string, WorkspaceChangesCacheEntry>();

interface NameStatusEntry {
	path: string;
	status: RuntimeWorkspaceFileStatus;
	previousPath?: string;
}

interface ChangesBetweenRefsInput {
	cwd: string;
	fromRef: string;
	toRef: string;
}

interface ChangesFromRefInput {
	cwd: string;
	fromRef: string;
}

interface DiffStat {
	additions: number;
	deletions: number;
}

interface FileFingerprint {
	path: string;
	size: number | null;
	mtimeMs: number | null;
	ctimeMs: number | null;
}

function estimateTextBytes(value: string | null): number {
	if (!value) {
		return 0;
	}
	return Buffer.byteLength(value, "utf8");
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

async function buildFileFingerprints(repoRoot: string, paths: string[]): Promise<FileFingerprint[]> {
	if (paths.length === 0) {
		return [];
	}
	const uniqueSortedPaths = Array.from(new Set(paths)).sort((left, right) => left.localeCompare(right));
	const entries = await Promise.all(
		uniqueSortedPaths.map(async (path) => {
			const absolutePath = join(repoRoot, path);
			try {
				const fileStat = await stat(absolutePath);
				return {
					path,
					size: fileStat.size,
					mtimeMs: fileStat.mtimeMs,
					ctimeMs: fileStat.ctimeMs,
				} satisfies FileFingerprint;
			} catch {
				return {
					path,
					size: null,
					mtimeMs: null,
					ctimeMs: null,
				} satisfies FileFingerprint;
			}
		}),
	);
	return entries;
}

function buildWorkspaceChangesStateKey(input: {
	repoRoot: string;
	headCommit: string | null;
	trackedChangesOutput: string;
	untrackedOutput: string;
	fingerprints: FileFingerprint[];
}): string {
	const fingerprintsToken = input.fingerprints
		.map((entry) => `${entry.path}\t${entry.size ?? "null"}\t${entry.mtimeMs ?? "null"}\t${entry.ctimeMs ?? "null"}`)
		.join("\n");
	return [
		input.repoRoot,
		input.headCommit ?? "no-head",
		input.trackedChangesOutput,
		input.untrackedOutput,
		fingerprintsToken,
	].join("\n--\n");
}

function pruneWorkspaceChangesCache(): void {
	if (workspaceChangesCacheByRepoRoot.size <= WORKSPACE_CHANGES_CACHE_MAX_ENTRIES) {
		return;
	}
	const entries = Array.from(workspaceChangesCacheByRepoRoot.entries()).sort(
		(left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt,
	);
	const removeCount = entries.length - WORKSPACE_CHANGES_CACHE_MAX_ENTRIES;
	for (let index = 0; index < removeCount; index += 1) {
		const candidate = entries[index];
		if (!candidate) {
			break;
		}
		workspaceChangesCacheByRepoRoot.delete(candidate[0]);
	}
}

async function readHeadFile(repoRoot: string, path: string): Promise<string | null> {
	try {
		return await getGitStdout(["show", `HEAD:${path}`], repoRoot);
	} catch {
		return null;
	}
}

async function readFileAtRef(repoRoot: string, ref: string, path: string): Promise<string | null> {
	try {
		return await getGitStdout(["show", `${ref}:${path}`], repoRoot);
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
		const output = await getGitStdout(["diff", "--numstat", "HEAD", "--", path], repoRoot);
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

async function readDiffStatBetweenRefs(
	repoRoot: string,
	fromRef: string,
	toRef: string,
	path: string,
): Promise<DiffStat | null> {
	try {
		const output = await getGitStdout(["diff", "--numstat", fromRef, toRef, "--", path], repoRoot);
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

async function readDiffStatFromRef(repoRoot: string, fromRef: string, path: string): Promise<DiffStat | null> {
	try {
		const output = await getGitStdout(["diff", "--numstat", fromRef, "--", path], repoRoot);
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

async function buildFileChangeBetweenRefs(
	repoRoot: string,
	entry: NameStatusEntry,
	fromRef: string,
	toRef: string,
): Promise<RuntimeWorkspaceFileChange> {
	const basePath = entry.previousPath ?? entry.path;
	const oldText = entry.status === "added" ? null : await readFileAtRef(repoRoot, fromRef, basePath);
	const newText = entry.status === "deleted" ? null : await readFileAtRef(repoRoot, toRef, entry.path);
	const stats =
		(await readDiffStatBetweenRefs(repoRoot, fromRef, toRef, entry.path)) ?? fallbackStats(oldText, newText);

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

async function buildFileChangeFromRef(
	repoRoot: string,
	entry: NameStatusEntry,
	fromRef: string,
): Promise<RuntimeWorkspaceFileChange> {
	const basePath = entry.previousPath ?? entry.path;
	const oldText =
		entry.status === "added" || entry.status === "untracked"
			? null
			: await readFileAtRef(repoRoot, fromRef, basePath);
	const newText = entry.status === "deleted" ? null : await readWorkingTreeFile(repoRoot, entry.path);
	const stats =
		entry.status === "untracked"
			? { additions: toLineCount(newText ?? ""), deletions: 0 }
			: ((await readDiffStatFromRef(repoRoot, fromRef, entry.path)) ?? fallbackStats(oldText, newText));

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

function createWorkspaceChangesResponse(input: {
	repoRoot: string;
	files: RuntimeWorkspaceChangesResponse["files"];
	totalFileCount?: number;
	truncated?: boolean;
	warning?: string | null;
}): RuntimeWorkspaceChangesResponse {
	return {
		repoRoot: input.repoRoot,
		generatedAt: Date.now(),
		files: input.files,
		totalFileCount: input.totalFileCount ?? input.files.length,
		truncated: input.truncated ?? false,
		warning: input.warning ?? null,
	};
}

function createTruncatedWorkspaceChangesResponse(input: {
	repoRoot: string;
	totalFileCount: number;
	warning: string;
}): RuntimeWorkspaceChangesResponse {
	return createWorkspaceChangesResponse({
		repoRoot: input.repoRoot,
		files: [],
		totalFileCount: input.totalFileCount,
		truncated: true,
		warning: input.warning,
	});
}

async function buildWorkspaceChangesWithTextBudget(
	builders: Array<() => Promise<RuntimeWorkspaceChangesResponse["files"][number]>>,
	repoRoot: string,
	totalFileCount: number,
): Promise<RuntimeWorkspaceChangesResponse> {
	const files: RuntimeWorkspaceChangesResponse["files"] = [];
	let totalTextBytes = 0;
	for (const build of builders) {
		const file = await build();
		totalTextBytes += estimateTextBytes(file.oldText) + estimateTextBytes(file.newText);
		if (totalTextBytes > MAX_WORKSPACE_CHANGE_TEXT_BYTES) {
			return createTruncatedWorkspaceChangesResponse({
				repoRoot,
				totalFileCount,
				warning: `Too many changes to render safely. This view is limited to ${MAX_WORKSPACE_CHANGE_FILES} files or ${Math.floor(
					MAX_WORKSPACE_CHANGE_TEXT_BYTES / 1_000_000,
				)} MB of diff text.`,
			});
		}
		files.push(file);
	}
	files.sort((left, right) => left.path.localeCompare(right.path));
	return createWorkspaceChangesResponse({
		repoRoot,
		files,
		totalFileCount,
	});
}

export async function createEmptyWorkspaceChangesResponse(cwd: string): Promise<RuntimeWorkspaceChangesResponse> {
	const repoRoot = (await getGitStdout(["rev-parse", "--show-toplevel"], cwd)).trim();
	if (!repoRoot) {
		throw new Error("Could not resolve git repository root.");
	}
	return createWorkspaceChangesResponse({
		repoRoot,
		files: [],
	});
}

export async function getWorkspaceChanges(cwd: string): Promise<RuntimeWorkspaceChangesResponse> {
	const repoRoot = (await getGitStdout(["rev-parse", "--show-toplevel"], cwd)).trim();
	if (!repoRoot) {
		throw new Error("Could not resolve git repository root.");
	}

	const [trackedChangesOutput, untrackedOutput, headCommitOutput] = await Promise.all([
		getGitStdout(["diff", "--name-status", "HEAD", "--"], repoRoot),
		getGitStdout(["ls-files", "--others", "--exclude-standard"], repoRoot),
		getGitStdout(["rev-parse", "--verify", "HEAD"], repoRoot).catch(() => ""),
	]);
	const trackedChanges = parseTrackedChanges(trackedChangesOutput);
	const untrackedPaths = untrackedOutput
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
	if (allChanges.length > MAX_WORKSPACE_CHANGE_FILES) {
		return createTruncatedWorkspaceChangesResponse({
			repoRoot,
			totalFileCount: allChanges.length,
			warning: `Too many changes to render safely. This view is limited to ${MAX_WORKSPACE_CHANGE_FILES} files or ${Math.floor(
				MAX_WORKSPACE_CHANGE_TEXT_BYTES / 1_000_000,
			)} MB of diff text.`,
		});
	}
	const fingerprintPaths = allChanges.flatMap((entry) => [entry.path, entry.previousPath].filter(Boolean) as string[]);
	const fingerprints = await buildFileFingerprints(repoRoot, fingerprintPaths);
	const stateKey = buildWorkspaceChangesStateKey({
		repoRoot,
		headCommit: headCommitOutput.trim() || null,
		trackedChangesOutput,
		untrackedOutput,
		fingerprints,
	});
	const existing = workspaceChangesCacheByRepoRoot.get(repoRoot);
	if (existing && existing.stateKey === stateKey) {
		existing.lastAccessedAt = Date.now();
		return existing.response;
	}

	const response = await buildWorkspaceChangesWithTextBudget(
		allChanges.map((entry) => () => buildFileChange(repoRoot, entry)),
		repoRoot,
		allChanges.length,
	);
	workspaceChangesCacheByRepoRoot.set(repoRoot, {
		stateKey,
		response,
		lastAccessedAt: Date.now(),
	});
	pruneWorkspaceChangesCache();
	return response;
}

export async function getWorkspaceChangesBetweenRefs(
	input: ChangesBetweenRefsInput,
): Promise<RuntimeWorkspaceChangesResponse> {
	const repoRoot = (await getGitStdout(["rev-parse", "--show-toplevel"], input.cwd)).trim();
	if (!repoRoot) {
		throw new Error("Could not resolve git repository root.");
	}

	const trackedChangesOutput = await getGitStdout(
		["diff", "--name-status", "--find-renames", input.fromRef, input.toRef, "--"],
		repoRoot,
	);
	const trackedChanges = parseTrackedChanges(trackedChangesOutput);
	if (trackedChanges.length === 0) {
		return createWorkspaceChangesResponse({
			repoRoot,
			files: [],
		});
	}
	if (trackedChanges.length > MAX_WORKSPACE_CHANGE_FILES) {
		return createTruncatedWorkspaceChangesResponse({
			repoRoot,
			totalFileCount: trackedChanges.length,
			warning: `Too many changes to render safely. This view is limited to ${MAX_WORKSPACE_CHANGE_FILES} files or ${Math.floor(
				MAX_WORKSPACE_CHANGE_TEXT_BYTES / 1_000_000,
			)} MB of diff text.`,
		});
	}

	return await buildWorkspaceChangesWithTextBudget(
		trackedChanges.map((entry) => () => buildFileChangeBetweenRefs(repoRoot, entry, input.fromRef, input.toRef)),
		repoRoot,
		trackedChanges.length,
	);
}

export async function getWorkspaceChangesFromRef(input: ChangesFromRefInput): Promise<RuntimeWorkspaceChangesResponse> {
	const repoRoot = (await getGitStdout(["rev-parse", "--show-toplevel"], input.cwd)).trim();
	if (!repoRoot) {
		throw new Error("Could not resolve git repository root.");
	}

	const [trackedChangesOutput, untrackedOutput] = await Promise.all([
		getGitStdout(["diff", "--name-status", "--find-renames", input.fromRef, "--"], repoRoot),
		getGitStdout(["ls-files", "--others", "--exclude-standard"], repoRoot),
	]);
	const trackedChanges = parseTrackedChanges(trackedChangesOutput);
	const untrackedPaths = untrackedOutput
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

	if (allChanges.length === 0) {
		return createWorkspaceChangesResponse({
			repoRoot,
			files: [],
		});
	}
	if (allChanges.length > MAX_WORKSPACE_CHANGE_FILES) {
		return createTruncatedWorkspaceChangesResponse({
			repoRoot,
			totalFileCount: allChanges.length,
			warning: `Too many changes to render safely. This view is limited to ${MAX_WORKSPACE_CHANGE_FILES} files or ${Math.floor(
				MAX_WORKSPACE_CHANGE_TEXT_BYTES / 1_000_000,
			)} MB of diff text.`,
		});
	}
	return await buildWorkspaceChangesWithTextBudget(
		allChanges.map((entry) => () => buildFileChangeFromRef(repoRoot, entry, input.fromRef)),
		repoRoot,
		allChanges.length,
	);
}
