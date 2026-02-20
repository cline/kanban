import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { RuntimeWorkspaceFileSearchMatch } from "../api-contract.js";

const execFileAsync = promisify(execFile);
const CACHE_TTL_MS = 10_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface CachedFileIndex {
	expiresAt: number;
	files: string[];
	changedPaths: Set<string>;
}

const fileIndexCache = new Map<string, CachedFileIndex>();

function normalizeLines(stdout: string): string[] {
	const seen = new Set<string>();
	const files: string[] = [];
	for (const rawLine of stdout.split(/\r?\n/g)) {
		const line = rawLine.trim();
		if (!line || seen.has(line)) {
			continue;
		}
		seen.add(line);
		files.push(line);
	}
	return files;
}

function getCachedFileIndex(cwd: string): string[] | null {
	const cached = fileIndexCache.get(cwd);
	if (!cached) {
		return null;
	}
	if (cached.expiresAt <= Date.now()) {
		fileIndexCache.delete(cwd);
		return null;
	}
	return cached.files;
}

function getCachedChangedPaths(cwd: string): Set<string> | null {
	const cached = fileIndexCache.get(cwd);
	if (!cached) {
		return null;
	}
	if (cached.expiresAt <= Date.now()) {
		fileIndexCache.delete(cwd);
		return null;
	}
	return cached.changedPaths;
}

function parsePorcelainChangedPaths(stdout: string): Set<string> {
	const changed = new Set<string>();
	for (const rawLine of stdout.split(/\r?\n/g)) {
		const line = rawLine.trimEnd();
		if (!line || line.length < 4) {
			continue;
		}
		const payload = line.slice(3).trim();
		if (!payload) {
			continue;
		}
		const renamedParts = payload.split(" -> ");
		const path = renamedParts[renamedParts.length - 1]?.trim();
		if (!path) {
			continue;
		}
		changed.add(path);
	}
	return changed;
}

async function loadFileIndex(cwd: string): Promise<{ files: string[]; changedPaths: Set<string> }> {
	const cached = getCachedFileIndex(cwd);
	const cachedChangedPaths = getCachedChangedPaths(cwd);
	if (cached && cachedChangedPaths) {
		return {
			files: cached,
			changedPaths: cachedChangedPaths,
		};
	}

	try {
		const [filesResult, statusResult] = await Promise.all([
			execFileAsync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
				cwd,
				maxBuffer: 8 * 1024 * 1024,
			}),
			execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
				cwd,
				maxBuffer: 8 * 1024 * 1024,
			}).catch(() => ({ stdout: "" })),
		]);
		const files = normalizeLines(filesResult.stdout);
		const changedPaths = parsePorcelainChangedPaths(statusResult.stdout);
		fileIndexCache.set(cwd, {
			expiresAt: Date.now() + CACHE_TTL_MS,
			files,
			changedPaths,
		});
		return { files, changedPaths };
	} catch {
		return {
			files: [],
			changedPaths: new Set<string>(),
		};
	}
}

function getMatchScore(path: string, queryLower: string): number | null {
	const pathLower = path.toLowerCase();
	const name = path.slice(path.lastIndexOf("/") + 1);
	const nameLower = name.toLowerCase();

	if (nameLower.startsWith(queryLower)) {
		return 0;
	}
	if (pathLower.startsWith(queryLower)) {
		return 1;
	}
	if (nameLower.includes(queryLower)) {
		return 2;
	}
	if (pathLower.includes(queryLower)) {
		return 3;
	}
	return null;
}

function normalizeLimit(limit: number | undefined): number {
	if (!Number.isFinite(limit)) {
		return DEFAULT_LIMIT;
	}
	const rounded = Math.floor(limit ?? DEFAULT_LIMIT);
	return Math.max(1, Math.min(MAX_LIMIT, rounded));
}

export async function searchWorkspaceFiles(
	cwd: string,
	query: string,
	limit?: number,
): Promise<RuntimeWorkspaceFileSearchMatch[]> {
	const trimmedQuery = query.trim();
	const normalizedLimit = normalizeLimit(limit);
	const { files, changedPaths } = await loadFileIndex(cwd);
	if (files.length === 0) {
		return [];
	}
	if (!trimmedQuery) {
		const sorted = [...files].sort((left, right) => {
			const leftChanged = changedPaths.has(left);
			const rightChanged = changedPaths.has(right);
			if (leftChanged !== rightChanged) {
				return leftChanged ? -1 : 1;
			}
			return left.localeCompare(right);
		});
		return sorted.slice(0, normalizedLimit).map((path) => ({
			path,
			name: path.slice(path.lastIndexOf("/") + 1) || path,
			changed: changedPaths.has(path),
		}));
	}

	const queryLower = trimmedQuery.toLowerCase();
	const ranked = files
		.map((path) => {
			const score = getMatchScore(path, queryLower);
			if (score == null) {
				return null;
			}
			return { path, score, changed: changedPaths.has(path) };
		})
		.filter((entry): entry is { path: string; score: number; changed: boolean } => entry !== null)
		.sort((left, right) => {
			if (left.changed !== right.changed) {
				return left.changed ? -1 : 1;
			}
			if (left.score !== right.score) {
				return left.score - right.score;
			}
			if (left.path.length !== right.path.length) {
				return left.path.length - right.path.length;
			}
			return left.path.localeCompare(right.path);
		});

	return ranked.slice(0, normalizedLimit).map((entry) => ({
		path: entry.path,
		name: entry.path.slice(entry.path.lastIndexOf("/") + 1) || entry.path,
		changed: entry.changed,
	}));
}
