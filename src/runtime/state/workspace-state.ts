import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type {
	RuntimeAvailableCommand,
	RuntimeBoardCard,
	RuntimeBoardColumn,
	RuntimeBoardColumnId,
	RuntimeBoardData,
	RuntimeChatSessionState,
	RuntimeWorkspaceStateResponse,
	RuntimeWorkspaceStateSaveRequest,
} from "../acp/api-contract.js";

const RUNTIME_HOME_DIR = ".kanbanana";
const WORKSPACES_DIR = "workspaces";
const INDEX_FILENAME = "index.json";
const BOARD_FILENAME = "board.json";
const SESSIONS_FILENAME = "sessions.json";
const INDEX_VERSION = 1;

const BOARD_COLUMNS: Array<{ id: RuntimeBoardColumnId; title: string }> = [
	{ id: "backlog", title: "Backlog" },
	{ id: "todo", title: "To Do" },
	{ id: "in_progress", title: "In Progress" },
	{ id: "ready_for_review", title: "Ready for Review" },
	{ id: "done", title: "Done" },
];

const VALID_SESSION_STATUSES = new Set(["idle", "thinking", "tool_running", "cancelled"]);

interface WorkspaceIndexEntry {
	workspaceId: string;
	repoPath: string;
	createdAt: number;
	updatedAt: number;
}

interface WorkspaceIndexFile {
	version: number;
	entries: Record<string, WorkspaceIndexEntry>;
	repoPathToId: Record<string, string>;
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

function getRuntimeHomePath(): string {
	return join(homedir(), RUNTIME_HOME_DIR);
}

function getWorkspacesRootPath(): string {
	return join(getRuntimeHomePath(), WORKSPACES_DIR);
}

function getWorkspaceIndexPath(): string {
	return join(getWorkspacesRootPath(), INDEX_FILENAME);
}

function getWorkspaceDirectoryPath(workspaceId: string): string {
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
	if (
		input === "backlog" ||
		input === "todo" ||
		input === "in_progress" ||
		input === "ready_for_review" ||
		input === "done"
	) {
		return input;
	}
	if (input === "planning") {
		return "todo";
	}
	if (input === "running") {
		return "in_progress";
	}
	if (input === "review") {
		return "ready_for_review";
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
		body?: unknown;
		createdAt?: unknown;
		updatedAt?: unknown;
	};

	const titleFromBody = typeof source.body === "string" ? source.body : "";
	const title = typeof source.title === "string" ? source.title.trim() : titleFromBody.trim();
	if (!title) {
		return null;
	}

	const now = Date.now();
	return {
		id: typeof source.id === "string" && source.id ? source.id : `task-${Math.random().toString(36).slice(2, 10)}`,
		title,
		description:
			typeof source.description === "string"
				? source.description
				: typeof source.body === "string"
					? source.body
					: "",
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

function normalizeAvailableCommands(raw: unknown): RuntimeAvailableCommand[] {
	if (!Array.isArray(raw)) {
		return [];
	}

	const commands: RuntimeAvailableCommand[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") {
			continue;
		}
		const candidate = entry as { name?: unknown; description?: unknown; input?: unknown };
		if (typeof candidate.name !== "string" || typeof candidate.description !== "string") {
			continue;
		}
		const input =
			candidate.input &&
			typeof candidate.input === "object" &&
			typeof (candidate.input as { hint?: unknown }).hint === "string"
				? { hint: (candidate.input as { hint: string }).hint }
				: undefined;
		commands.push({
			name: candidate.name,
			description: candidate.description,
			input,
		});
	}

	return commands;
}

function normalizeSessions(rawSessions: unknown): Record<string, RuntimeChatSessionState> {
	if (!rawSessions || typeof rawSessions !== "object" || Array.isArray(rawSessions)) {
		return {};
	}

	const sessions: Record<string, RuntimeChatSessionState> = {};
	for (const [taskId, value] of Object.entries(rawSessions as Record<string, unknown>)) {
		if (!value || typeof value !== "object") {
			continue;
		}
		const source = value as {
			sessionId?: unknown;
			status?: unknown;
			timeline?: unknown;
			availableCommands?: unknown;
		};

		sessions[taskId] = {
			sessionId: typeof source.sessionId === "string" && source.sessionId ? source.sessionId : `task-${taskId}`,
			status: VALID_SESSION_STATUSES.has(source.status as string)
				? (source.status as RuntimeChatSessionState["status"])
				: "idle",
			timeline: Array.isArray(source.timeline) ? (source.timeline as RuntimeChatSessionState["timeline"]) : [],
			availableCommands: normalizeAvailableCommands(source.availableCommands),
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
			const candidate = value as {
				workspaceId?: unknown;
				repoPath?: unknown;
				createdAt?: unknown;
				updatedAt?: unknown;
			};
			const entryRepoPath = typeof candidate.repoPath === "string" ? candidate.repoPath.trim() : "";
			if (!entryRepoPath) {
				continue;
			}
			const entryId =
				typeof candidate.workspaceId === "string" && candidate.workspaceId ? candidate.workspaceId : workspaceId;
			entries[entryId] = {
				workspaceId: entryId,
				repoPath: entryRepoPath,
				createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now(),
				updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : Date.now(),
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
	now = Date.now(),
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
		createdAt: now,
		updatedAt: now,
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

function toWorkspaceStateResponse(
	repoPath: string,
	workspaceId: string,
	board: RuntimeBoardData,
	sessions: Record<string, RuntimeChatSessionState>,
): RuntimeWorkspaceStateResponse {
	return {
		repoPath,
		statePath: getWorkspaceDirectoryPath(workspaceId),
		board,
		sessions,
	};
}

function detectGitRoot(cwd: string): string | null {
	const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (result.status !== 0 || typeof result.stdout !== "string") {
		return null;
	}
	const root = result.stdout.trim();
	return root ? root : null;
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

export async function loadWorkspaceState(cwd: string): Promise<RuntimeWorkspaceStateResponse> {
	const repoPath = await resolveWorkspacePath(cwd);
	let index = await readWorkspaceIndex();
	const ensured = ensureWorkspaceEntry(index, repoPath);
	index = ensured.index;
	if (ensured.changed) {
		await writeWorkspaceIndex(index);
	}

	const board = normalizeBoard(await readJsonFile(getWorkspaceBoardPath(ensured.entry.workspaceId)));
	const sessions = normalizeSessions(await readJsonFile(getWorkspaceSessionsPath(ensured.entry.workspaceId)));

	return toWorkspaceStateResponse(repoPath, ensured.entry.workspaceId, board, sessions);
}

export async function saveWorkspaceState(
	cwd: string,
	payload: RuntimeWorkspaceStateSaveRequest,
): Promise<RuntimeWorkspaceStateResponse> {
	const repoPath = await resolveWorkspacePath(cwd);
	let index = await readWorkspaceIndex();
	const ensured = ensureWorkspaceEntry(index, repoPath);
	index = ensured.index;

	const board = normalizeBoard(payload.board);
	const sessions = normalizeSessions(payload.sessions);

	await writeJsonFileAtomic(getWorkspaceBoardPath(ensured.entry.workspaceId), board);
	await writeJsonFileAtomic(getWorkspaceSessionsPath(ensured.entry.workspaceId), sessions);

	const now = Date.now();
	const updatedEntry: WorkspaceIndexEntry = {
		...ensured.entry,
		updatedAt: now,
	};
	index = {
		version: INDEX_VERSION,
		entries: {
			...index.entries,
			[updatedEntry.workspaceId]: updatedEntry,
		},
		repoPathToId: {
			...index.repoPathToId,
			[repoPath]: updatedEntry.workspaceId,
		},
	};
	await writeWorkspaceIndex(index);

	return toWorkspaceStateResponse(repoPath, updatedEntry.workspaceId, board, sessions);
}
