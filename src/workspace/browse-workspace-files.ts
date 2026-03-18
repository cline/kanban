import { readFile as fsReadFile, writeFile as fsWriteFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

const BINARY_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"bmp",
	"ico",
	"webp",
	"avif",
	"mp3",
	"mp4",
	"wav",
	"ogg",
	"webm",
	"flac",
	"aac",
	"zip",
	"tar",
	"gz",
	"bz2",
	"xz",
	"7z",
	"rar",
	"pdf",
	"doc",
	"docx",
	"xls",
	"xlsx",
	"ppt",
	"pptx",
	"exe",
	"dll",
	"so",
	"dylib",
	"bin",
	"dat",
	"woff",
	"woff2",
	"ttf",
	"eot",
	"otf",
	"sqlite",
	"db",
	"o",
	"obj",
	"class",
	"pyc",
	"wasm",
]);

function isBinaryPath(filePath: string): boolean {
	const ext = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
	return BINARY_EXTENSIONS.has(ext);
}

function isBinaryBuffer(buffer: Buffer): boolean {
	const check = buffer.subarray(0, Math.min(8192, buffer.length));
	for (let i = 0; i < check.length; i++) {
		const byte = check[i]!;
		if (byte === 0) return true;
		if (byte < 7 && byte !== 0) return true;
	}
	return false;
}

function securePath(cwd: string, requestedPath: string): string {
	const resolved = resolve(cwd, requestedPath);
	if (!resolved.startsWith(cwd)) {
		throw new Error("Path traversal not allowed");
	}
	return resolved;
}

export interface RuntimeDirectoryEntry {
	name: string;
	path: string;
	type: "file" | "directory";
}

export async function listDirectoryEntries(
	cwd: string,
	dirPath: string,
): Promise<{ entries: RuntimeDirectoryEntry[] }> {
	const targetDir = dirPath ? securePath(cwd, dirPath) : cwd;
	const items = await readdir(targetDir, { withFileTypes: true });
	const entries: RuntimeDirectoryEntry[] = [];

	const dirs: RuntimeDirectoryEntry[] = [];
	const files: RuntimeDirectoryEntry[] = [];

	for (const item of items) {
		if (item.name === ".git" || item.name === "node_modules" || item.name === ".worktrees") {
			continue;
		}
		const entryPath = relative(cwd, join(targetDir, item.name));
		if (item.isDirectory()) {
			dirs.push({ name: item.name, path: entryPath, type: "directory" });
		} else if (item.isFile() || item.isSymbolicLink()) {
			files.push({ name: item.name, path: entryPath, type: "file" });
		}
	}

	dirs.sort((a, b) => a.name.localeCompare(b.name));
	files.sort((a, b) => a.name.localeCompare(b.name));
	entries.push(...dirs, ...files);

	return { entries };
}

export interface RuntimeFileReadResponse {
	path: string;
	content: string | null;
	size: number;
	isBinary: boolean;
	error?: string;
}

export async function readWorkspaceFile(cwd: string, filePath: string): Promise<RuntimeFileReadResponse> {
	const fullPath = securePath(cwd, filePath);

	try {
		const fileStat = await stat(fullPath);
		if (!fileStat.isFile()) {
			return { path: filePath, content: null, size: 0, isBinary: false, error: "Not a file" };
		}

		if (fileStat.size > MAX_FILE_SIZE) {
			return {
				path: filePath,
				content: null,
				size: fileStat.size,
				isBinary: false,
				error: `File too large (${Math.round(fileStat.size / 1024)}KB). Max: ${MAX_FILE_SIZE / 1024}KB`,
			};
		}

		if (isBinaryPath(filePath)) {
			return { path: filePath, content: null, size: fileStat.size, isBinary: true };
		}

		const buffer = await fsReadFile(fullPath);
		if (isBinaryBuffer(buffer)) {
			return { path: filePath, content: null, size: fileStat.size, isBinary: true };
		}

		return { path: filePath, content: buffer.toString("utf-8"), size: fileStat.size, isBinary: false };
	} catch (err) {
		return {
			path: filePath,
			content: null,
			size: 0,
			isBinary: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export interface RuntimeFileWriteResponse {
	ok: boolean;
	error?: string;
}

export async function writeWorkspaceFile(
	cwd: string,
	filePath: string,
	content: string,
): Promise<RuntimeFileWriteResponse> {
	const fullPath = securePath(cwd, filePath);

	try {
		await fsWriteFile(fullPath, content, "utf-8");
		return { ok: true };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
