import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type {
	RuntimeBoardCard,
	RuntimeBoardColumn,
	RuntimeBoardColumnId,
	RuntimeBoardData,
	RuntimeGitRepositoryInfo,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceStateResponse,
	RuntimeWorkspaceStateSaveRequest,
} from "../api-contract.js";

const RUNTIME_HOME_DIR = ".kanbanana";
const WORKSPACES_DIR = "workspaces";
const INDEX_FILENAME = "index.json";
const BOARD_FILENAME = "board.json";
const SESSIONS_FILENAME = "sessions.json";
const INDEX_VERSION = 1;
const TASK_ID_LENGTH = 5;

const BOARD_COLUMNS: Array<{ id: RuntimeBoardColumnId; title: string }> = [
	{ id: "backlog", title: "Backlog" },
	{ id: "in_progress", title: "In Progress" },
	{ id: "review", title: "Review" },
	{ id: "trash", title: "Trash" },
];

const VALID_SESSION_STATES = new Set(["idle", "running", "awaiting_review", "failed", "interrupted"]);
const VALID_REVIEW_REASONS = new Set(["attention", "exit", "error", "interrupted"]);

interface WorkspaceIndexEntry {
	workspaceId: string;
	repoPath: string;
}

interface WorkspaceIndexFile {
	version: number;
	entries: Record<string, WorkspaceIndexEntry>;
	repoPathToId: Record<string, string>;
}

export interface RuntimeWorkspaceContext {
	repoPath: string;
	workspaceId: string;
	statePath: string;
	git: RuntimeGitRepositoryInfo;
}

function createEmptyBoard(): RuntimeBoardData {
	return {
		columns: BOARD_COLUMNS.map((column) => ({
			id: column.id,
			title: column.title,
			cards: [],
		})),
	};
}

function createEmptyWorkspaceIndex(): WorkspaceIndexFile {
	return {
		version: INDEX_VERSION,
		entries: {},
		repoPathToId: {},
	};
}

function createDefaultSessionSummary(taskId: string): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "idle",
		agentId: null,
		workspacePath: null,
		pid: null,
		startedAt: null,
		updatedAt: Date.now(),
		lastOutputAt: null,
		lastActivityLine: null,
		reviewReason: null,
		exitCode: null,
	};
}

function createShortTaskId(): string {
	return Math.random()
		.toString(36)
		.slice(2, 2 + TASK_ID_LENGTH);
}

export function getRuntimeHomePath(): string {
	return join(homedir(), RUNTIME_HOME_DIR);
}

export function getWorkspacesRootPath(): string {
	return join(getRuntimeHomePath(), WORKSPACES_DIR);
}

function getWorkspaceIndexPath(): string {
	return join(getWorkspacesRootPath(), INDEX_FILENAME);
}

export function getWorkspaceDirectoryPath(workspaceId: string): string {
	return join(getWorkspacesRootPath(), workspaceId);
}

function getWorkspaceBoardPath(workspaceId: string): string {
	return join(getWorkspaceDirectoryPath(workspaceId), BOARD_FILENAME);
}

function getWorkspaceSessionsPath(workspaceId: string): string {
	return join(getWorkspaceDirectoryPath(workspaceId), SESSIONS_FILENAME);
}

async function readJsonFile(path: string): Promise<unknown | null> {
	try {
		const raw = await readFile(path, "utf8");
		return JSON.parse(raw) as unknown;
	} catch {
		return null;
	}
}

async function writeJsonFileAtomic(path: string, payload: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tempPath = `${path}.tmp.${process.pid}.${Date.now()}`;
	await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
	await rename(tempPath, path);
}

function normalizeColumnId(input: unknown): RuntimeBoardColumnId | null {
	if (input === "backlog" || input === "in_progress" || input === "review" || input === "trash") {
		return input;
	}
	return null;
}

function normalizeBoardCard(card: unknown): RuntimeBoardCard | null {
	if (!card || typeof card !== "object") {
		return null;
	}

	const source = card as {
		id?: unknown;
		title?: unknown;
		description?: unknown;
		prompt?: unknown;
		startInPlanMode?: unknown;
		baseRef?: unknown;
		createdAt?: unknown;
		updatedAt?: unknown;
	};

	const title = typeof source.title === "string" ? source.title.trim() : "";
	if (!title) {
		return null;
	}

	const now = Date.now();
	const description = typeof source.description === "string" ? source.description : "";
	const prompt = typeof source.prompt === "string" ? source.prompt : description.trim() || title;

	return {
		id: typeof source.id === "string" && source.id ? source.id : createShortTaskId(),
		title,
		description,
		prompt,
		startInPlanMode: typeof source.startInPlanMode === "boolean" ? source.startInPlanMode : false,
		baseRef: typeof source.baseRef === "string" ? source.baseRef.trim() || null : null,
		createdAt: typeof source.createdAt === "number" ? source.createdAt : now,
		updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : now,
	};
}

function normalizeBoard(rawBoard: unknown): RuntimeBoardData {
	if (!rawBoard || typeof rawBoard !== "object") {
		return createEmptyBoard();
	}

	const rawColumns = (rawBoard as { columns?: unknown }).columns;
	if (!Array.isArray(rawColumns)) {
		return createEmptyBoard();
	}

	const normalizedColumns: RuntimeBoardColumn[] = BOARD_COLUMNS.map((column) => ({
		id: column.id,
		title: column.title,
		cards: [],
	}));
	const columnById = new Map(normalizedColumns.map((column) => [column.id, column]));

	for (const rawColumn of rawColumns) {
		if (!rawColumn || typeof rawColumn !== "object") {
			continue;
		}
		const candidate = rawColumn as { id?: unknown; cards?: unknown };
		const normalizedId = normalizeColumnId(candidate.id);
		if (!normalizedId || !Array.isArray(candidate.cards)) {
			continue;
		}
		const targetColumn = columnById.get(normalizedId);
		if (!targetColumn) {
			continue;
		}
		for (const rawCard of candidate.cards) {
			const card = normalizeBoardCard(rawCard);
			if (card) {
				targetColumn.cards.push(card);
			}
		}
	}

	return {
		columns: normalizedColumns,
	};
}

function normalizeSessionState(value: unknown): RuntimeTaskSessionSummary["state"] {
	if (typeof value === "string" && VALID_SESSION_STATES.has(value)) {
		return value as RuntimeTaskSessionSummary["state"];
	}
	return "idle";
}

function normalizeReviewReason(value: unknown): RuntimeTaskSessionSummary["reviewReason"] {
	if (typeof value === "string" && VALID_REVIEW_REASONS.has(value)) {
		return value as RuntimeTaskSessionSummary["reviewReason"];
	}
	return null;
}

function normalizeSessions(rawSessions: unknown): Record<string, RuntimeTaskSessionSummary> {
	if (!rawSessions || typeof rawSessions !== "object" || Array.isArray(rawSessions)) {
		return {};
	}

	const sessions: Record<string, RuntimeTaskSessionSummary> = {};
	for (const [taskId, value] of Object.entries(rawSessions as Record<string, unknown>)) {
		if (!value || typeof value !== "object") {
			continue;
		}
		const source = value as {
			taskId?: unknown;
			state?: unknown;
			agentId?: unknown;
			workspacePath?: unknown;
			pid?: unknown;
			startedAt?: unknown;
			updatedAt?: unknown;
			lastOutputAt?: unknown;
			lastActivityLine?: unknown;
			reviewReason?: unknown;
			exitCode?: unknown;
		};

		const base = createDefaultSessionSummary(taskId);
		sessions[taskId] = {
			...base,
			taskId: typeof source.taskId === "string" && source.taskId ? source.taskId : taskId,
			state: normalizeSessionState(source.state),
			agentId:
				source.agentId === "claude" ||
				source.agentId === "codex" ||
				source.agentId === "gemini" ||
				source.agentId === "opencode" ||
				source.agentId === "custom"
					? source.agentId
					: null,
			workspacePath: typeof source.workspacePath === "string" ? source.workspacePath : null,
			pid: typeof source.pid === "number" ? source.pid : null,
			startedAt: typeof source.startedAt === "number" ? source.startedAt : null,
			updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : base.updatedAt,
			lastOutputAt: typeof source.lastOutputAt === "number" ? source.lastOutputAt : null,
			lastActivityLine: typeof source.lastActivityLine === "string" ? source.lastActivityLine : null,
			reviewReason: normalizeReviewReason(source.reviewReason),
			exitCode: typeof source.exitCode === "number" ? source.exitCode : null,
		};
	}

	return sessions;
}

function normalizeWorkspaceIndex(rawIndex: unknown): WorkspaceIndexFile {
	if (!rawIndex || typeof rawIndex !== "object") {
		return createEmptyWorkspaceIndex();
	}

	const source = rawIndex as { entries?: unknown; repoPathToId?: unknown };
	const entries: Record<string, WorkspaceIndexEntry> = {};
	const repoPathToId: Record<string, string> = {};

	if (source.entries && typeof source.entries === "object" && !Array.isArray(source.entries)) {
		for (const [workspaceId, value] of Object.entries(source.entries as Record<string, unknown>)) {
			if (!value || typeof value !== "object") {
				continue;
			}
			const candidate = value as { workspaceId?: unknown; repoPath?: unknown };
			const entryRepoPath = typeof candidate.repoPath === "string" ? candidate.repoPath.trim() : "";
			if (!entryRepoPath) {
				continue;
			}
			const entryId =
				typeof candidate.workspaceId === "string" && candidate.workspaceId ? candidate.workspaceId : workspaceId;
			entries[entryId] = {
				workspaceId: entryId,
				repoPath: entryRepoPath,
			};
			repoPathToId[entryRepoPath] = entryId;
		}
	}

	if (source.repoPathToId && typeof source.repoPathToId === "object" && !Array.isArray(source.repoPathToId)) {
		for (const [repoPath, workspaceId] of Object.entries(source.repoPathToId as Record<string, unknown>)) {
			if (typeof workspaceId !== "string") {
				continue;
			}
			const entry = entries[workspaceId];
			if (!entry) {
				continue;
			}
			repoPathToId[repoPath] = workspaceId;
		}
	}

	return {
		version: INDEX_VERSION,
		entries,
		repoPathToId,
	};
}

async function readWorkspaceIndex(): Promise<WorkspaceIndexFile> {
	const raw = await readJsonFile(getWorkspaceIndexPath());
	return normalizeWorkspaceIndex(raw);
}

async function writeWorkspaceIndex(index: WorkspaceIndexFile): Promise<void> {
	await writeJsonFileAtomic(getWorkspaceIndexPath(), index);
}

function hashWorkspacePath(repoPath: string, salt = ""): string {
	return createHash("sha256").update(repoPath).update(salt).digest("hex").slice(0, 16);
}

function ensureWorkspaceEntry(
	index: WorkspaceIndexFile,
	repoPath: string,
): { index: WorkspaceIndexFile; entry: WorkspaceIndexEntry; changed: boolean } {
	const existingWorkspaceId = index.repoPathToId[repoPath];
	if (existingWorkspaceId) {
		const existingEntry = index.entries[existingWorkspaceId];
		if (existingEntry && existingEntry.repoPath === repoPath) {
			return {
				index,
				entry: existingEntry,
				changed: false,
			};
		}
	}

	let salt = "";
	let workspaceId = hashWorkspacePath(repoPath);
	while (index.entries[workspaceId] && index.entries[workspaceId]?.repoPath !== repoPath) {
		salt = `${salt}#`;
		workspaceId = hashWorkspacePath(repoPath, salt);
	}

	const entry: WorkspaceIndexEntry = {
		workspaceId,
		repoPath,
	};

	return {
		index: {
			version: INDEX_VERSION,
			entries: {
				...index.entries,
				[workspaceId]: entry,
			},
			repoPathToId: {
				...index.repoPathToId,
				[repoPath]: workspaceId,
			},
		},
		entry,
		changed: true,
	};
}

function runGitCapture(cwd: string, args: string[]): string | null {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (result.status !== 0 || typeof result.stdout !== "string") {
		return null;
	}
	const value = result.stdout.trim();
	return value.length > 0 ? value : null;
}

function detectGitRoot(cwd: string): string | null {
	return runGitCapture(cwd, ["rev-parse", "--show-toplevel"]);
}

function detectGitCurrentBranch(repoPath: string): string | null {
	return runGitCapture(repoPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
}

function detectGitBranches(repoPath: string): string[] {
	const output = runGitCapture(repoPath, [
		"for-each-ref",
		"--format=%(refname:short)",
		"refs/heads",
		"refs/remotes/origin",
	]);
	if (!output) {
		return [];
	}

	const unique = new Set<string>();
	for (const line of output.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed === "origin/HEAD" || trimmed === "HEAD") {
			continue;
		}
		const normalized = trimmed.startsWith("origin/") ? trimmed.slice("origin/".length) : trimmed;
		if (!normalized || normalized === "HEAD") {
			continue;
		}
		unique.add(normalized);
	}
	return Array.from(unique).sort((left, right) => left.localeCompare(right));
}

function detectGitDefaultBranch(repoPath: string, branches: string[]): string | null {
	const remoteHead = runGitCapture(repoPath, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
	if (remoteHead) {
		const normalized = remoteHead.startsWith("origin/") ? remoteHead.slice("origin/".length) : remoteHead;
		if (normalized) {
			return normalized;
		}
	}
	if (branches.includes("main")) {
		return "main";
	}
	if (branches.includes("master")) {
		return "master";
	}
	return branches[0] ?? null;
}

function detectGitRepositoryInfo(repoPath: string): RuntimeGitRepositoryInfo {
	if (!detectGitRoot(repoPath)) {
		return {
			hasGit: false,
			currentBranch: null,
			defaultBranch: null,
			branches: [],
		};
	}

	const currentBranch = detectGitCurrentBranch(repoPath);
	const branches = detectGitBranches(repoPath);
	const orderedBranches = currentBranch && !branches.includes(currentBranch) ? [currentBranch, ...branches] : branches;
	const defaultBranch = detectGitDefaultBranch(repoPath, orderedBranches);

	return {
		hasGit: true,
		currentBranch,
		defaultBranch,
		branches: orderedBranches,
	};
}

async function resolveWorkspacePath(cwd: string): Promise<string> {
	const resolvedCwd = resolve(cwd);
	let canonicalCwd = resolvedCwd;
	try {
		canonicalCwd = await realpath(resolvedCwd);
	} catch {
		canonicalCwd = resolvedCwd;
	}

	const gitRoot = detectGitRoot(canonicalCwd);
	if (!gitRoot) {
		return canonicalCwd;
	}

	const resolvedGitRoot = resolve(gitRoot);
	try {
		return await realpath(resolvedGitRoot);
	} catch {
		return resolvedGitRoot;
	}
}

function toWorkspaceStateResponse(
	context: RuntimeWorkspaceContext,
	board: RuntimeBoardData,
	sessions: Record<string, RuntimeTaskSessionSummary>,
): RuntimeWorkspaceStateResponse {
	return {
		repoPath: context.repoPath,
		statePath: context.statePath,
		git: context.git,
		board,
		sessions,
	};
}

export async function loadWorkspaceContext(cwd: string): Promise<RuntimeWorkspaceContext> {
	const repoPath = await resolveWorkspacePath(cwd);
	let index = await readWorkspaceIndex();
	const ensured = ensureWorkspaceEntry(index, repoPath);
	index = ensured.index;
	if (ensured.changed) {
		await writeWorkspaceIndex(index);
	}

	return {
		repoPath,
		workspaceId: ensured.entry.workspaceId,
		statePath: getWorkspaceDirectoryPath(ensured.entry.workspaceId),
		git: detectGitRepositoryInfo(repoPath),
	};
}

export async function loadWorkspaceState(cwd: string): Promise<RuntimeWorkspaceStateResponse> {
	const context = await loadWorkspaceContext(cwd);
	const board = normalizeBoard(await readJsonFile(getWorkspaceBoardPath(context.workspaceId)));
	const sessions = normalizeSessions(await readJsonFile(getWorkspaceSessionsPath(context.workspaceId)));
	return toWorkspaceStateResponse(context, board, sessions);
}

export async function saveWorkspaceState(
	cwd: string,
	payload: RuntimeWorkspaceStateSaveRequest,
): Promise<RuntimeWorkspaceStateResponse> {
	const context = await loadWorkspaceContext(cwd);
	const board = normalizeBoard(payload.board);
	const sessions = normalizeSessions(payload.sessions);

	await writeJsonFileAtomic(getWorkspaceBoardPath(context.workspaceId), board);
	await writeJsonFileAtomic(getWorkspaceSessionsPath(context.workspaceId), sessions);

	return toWorkspaceStateResponse(context, board, sessions);
}
