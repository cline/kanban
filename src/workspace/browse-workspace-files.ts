import { execFile } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import type {
	RuntimeWorkspaceDirectoryEntry,
	RuntimeWorkspaceDirectoryListResponse,
	RuntimeWorkspaceFileGitLineStatusResponse,
	RuntimeWorkspaceFileReadResponse,
	RuntimeWorkspaceFileWriteResponse,
	RuntimeWorkspaceGitLineChange,
} from "../core/api-contract";
import { createGitProcessEnv } from "../core/git-process-env";

const execFileAsync = promisify(execFile);
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const HUNK_HEADER_REGEX = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

const BINARY_EXTENSIONS = new Set([
	"7z",
	"aac",
	"avif",
	"bin",
	"bmp",
	"bz2",
	"class",
	"dat",
	"db",
	"dll",
	"doc",
	"docx",
	"dylib",
	"eot",
	"exe",
	"flac",
	"gif",
	"gz",
	"ico",
	"jpeg",
	"jpg",
	"mp3",
	"mp4",
	"obj",
	"o",
	"otf",
	"pdf",
	"png",
	"ppt",
	"pptx",
	"pyc",
	"rar",
	"so",
	"sqlite",
	"tar",
	"ttf",
	"wav",
	"wasm",
	"webm",
	"webp",
	"woff",
	"woff2",
	"xls",
	"xlsx",
	"xz",
	"zip",
]);

function resolveWorkspacePath(workspaceRoot: string, requestedPath: string): string {
	const normalizedRoot = resolve(workspaceRoot);
	const resolvedPath = resolve(normalizedRoot, requestedPath);
	const relativePath = relative(normalizedRoot, resolvedPath);
	if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
		throw new Error("Path traversal is not allowed.");
	}
	return resolvedPath;
}

function isBinaryPath(filePath: string): boolean {
	const lastDotIndex = filePath.lastIndexOf(".");
	if (lastDotIndex === -1) {
		return false;
	}
	return BINARY_EXTENSIONS.has(filePath.slice(lastDotIndex + 1).toLowerCase());
}

function isBinaryBuffer(buffer: Buffer): boolean {
	const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
	for (const byte of sample) {
		if (byte === 0 || byte < 7) {
			return true;
		}
	}
	return false;
}

function isIgnoredEntry(name: string): boolean {
	return name === ".git" || name === ".worktrees" || name === "node_modules";
}

function sortEntries(entries: RuntimeWorkspaceDirectoryEntry[]): RuntimeWorkspaceDirectoryEntry[] {
	return [...entries].sort((left, right) => {
		if (left.type !== right.type) {
			return left.type === "directory" ? -1 : 1;
		}
		return left.name.localeCompare(right.name);
	});
}

function parseGitDiffHunks(diffOutput: string): RuntimeWorkspaceGitLineChange[] {
	const changes: RuntimeWorkspaceGitLineChange[] = [];
	for (const line of diffOutput.split("\n")) {
		const match = HUNK_HEADER_REGEX.exec(line);
		if (!match) {
			continue;
		}
		const oldCount = match[2] ? Number.parseInt(match[2], 10) : 1;
		const newStart = Number.parseInt(match[3] ?? "1", 10);
		const newCount = match[4] ? Number.parseInt(match[4], 10) : 1;

		if (oldCount === 0 && newCount > 0) {
			changes.push({ type: "added", startLine: newStart, lineCount: newCount });
			continue;
		}
		if (newCount === 0 && oldCount > 0) {
			changes.push({ type: "deleted", startLine: Math.max(1, newStart), lineCount: 0 });
			continue;
		}
		changes.push({ type: "modified", startLine: newStart, lineCount: newCount });
	}
	return changes;
}

export async function listDirectoryEntries(
	workspaceRoot: string,
	dirPath: string,
): Promise<RuntimeWorkspaceDirectoryListResponse> {
	const targetDirectory = dirPath ? resolveWorkspacePath(workspaceRoot, dirPath) : resolve(workspaceRoot);
	const directoryEntries = await readdir(targetDirectory, { withFileTypes: true });
	const entries: RuntimeWorkspaceDirectoryEntry[] = [];

	for (const entry of directoryEntries) {
		if (isIgnoredEntry(entry.name)) {
			continue;
		}
		if (!entry.isDirectory() && !entry.isFile() && !entry.isSymbolicLink()) {
			continue;
		}

		const entryPath = relative(resolve(workspaceRoot), join(targetDirectory, entry.name));
		entries.push({
			name: entry.name,
			path: entryPath,
			type: entry.isDirectory() ? "directory" : "file",
		});
	}

	return {
		entries: sortEntries(entries),
	};
}

export async function readWorkspaceFile(
	workspaceRoot: string,
	filePath: string,
): Promise<RuntimeWorkspaceFileReadResponse> {
	const resolvedPath = resolveWorkspacePath(workspaceRoot, filePath);

	try {
		const fileStat = await stat(resolvedPath);
		if (!fileStat.isFile()) {
			return { path: filePath, content: null, size: 0, isBinary: false, error: "Not a file." };
		}
		if (fileStat.size > MAX_FILE_SIZE_BYTES) {
			return {
				path: filePath,
				content: null,
				size: fileStat.size,
				isBinary: false,
				error: `File too large (${Math.round(fileStat.size / 1024)} KB).`,
			};
		}
		if (isBinaryPath(filePath)) {
			return { path: filePath, content: null, size: fileStat.size, isBinary: true };
		}

		const buffer = await readFile(resolvedPath);
		if (isBinaryBuffer(buffer)) {
			return { path: filePath, content: null, size: fileStat.size, isBinary: true };
		}

		return {
			path: filePath,
			content: buffer.toString("utf8"),
			size: fileStat.size,
			isBinary: false,
		};
	} catch (error) {
		return {
			path: filePath,
			content: null,
			size: 0,
			isBinary: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function writeWorkspaceFile(
	workspaceRoot: string,
	filePath: string,
	content: string,
): Promise<RuntimeWorkspaceFileWriteResponse> {
	const resolvedPath = resolveWorkspacePath(workspaceRoot, filePath);

	try {
		await writeFile(resolvedPath, content, "utf8");
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function getFileGitLineStatus(
	workspaceRoot: string,
	filePath: string,
): Promise<RuntimeWorkspaceFileGitLineStatusResponse> {
	try {
		const { stdout } = await execFileAsync("git", ["diff", "--unified=0", "--no-color", "HEAD", "--", filePath], {
			cwd: workspaceRoot,
			env: createGitProcessEnv(),
			maxBuffer: 1024 * 1024,
		});
		return {
			path: filePath,
			changes: parseGitDiffHunks(stdout),
		};
	} catch {
		return {
			path: filePath,
			changes: [],
		};
	}
}
