import type { Stats } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

export const IMPORTABLE_WORKSPACE_MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);
export const MAX_WORKSPACE_MARKDOWN_FILE_BYTES = 256 * 1024;

export type WorkspaceFileReadErrorCode = "BAD_REQUEST" | "NOT_FOUND" | "INTERNAL_SERVER_ERROR";

export class WorkspaceFileReadError extends Error {
	readonly code: WorkspaceFileReadErrorCode;

	constructor(code: WorkspaceFileReadErrorCode, message: string) {
		super(message);
		this.name = "WorkspaceFileReadError";
		this.code = code;
	}
}

function createWorkspaceFileReadError(code: WorkspaceFileReadErrorCode, message: string): WorkspaceFileReadError {
	return new WorkspaceFileReadError(code, message);
}

function normalizeWorkspaceRelativePath(relativePath: string): { posixPath: string; platformPath: string } {
	const trimmedPath = relativePath.trim();
	if (!trimmedPath) {
		throw createWorkspaceFileReadError("BAD_REQUEST", "File path cannot be empty.");
	}

	const slashNormalizedPath = trimmedPath.replaceAll("\\", "/");
	if (isAbsolute(trimmedPath) || /^[A-Za-z]:\//.test(slashNormalizedPath)) {
		throw createWorkspaceFileReadError("BAD_REQUEST", "File path must be relative to the workspace.");
	}

	if (slashNormalizedPath.split("/").some((segment) => segment === "..")) {
		throw createWorkspaceFileReadError("BAD_REQUEST", "File path must stay within the workspace.");
	}

	const normalizedPosixPath = slashNormalizedPath
		.split("/")
		.filter((segment) => segment.length > 0 && segment !== ".")
		.join("/");
	if (!normalizedPosixPath) {
		throw createWorkspaceFileReadError("BAD_REQUEST", "File path cannot be empty.");
	}

	return {
		posixPath: normalizedPosixPath,
		platformPath: normalizedPosixPath.split("/").join(sep),
	};
}

function assertImportableMarkdownPath(relativePath: string): void {
	if (!IMPORTABLE_WORKSPACE_MARKDOWN_EXTENSIONS.has(extname(relativePath).toLowerCase())) {
		throw createWorkspaceFileReadError(
			"BAD_REQUEST",
			"Only .md, .markdown, and .mdx files can be imported.",
		);
	}
}

function isPathInsideWorkspace(workspacePath: string, targetPath: string): boolean {
	const relativePath = relative(workspacePath, targetPath);
	return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath));
}

export async function readWorkspaceMarkdownFile(
	workspacePath: string,
	relativePath: string,
): Promise<{ path: string; content: string }> {
	const normalizedPath = normalizeWorkspaceRelativePath(relativePath);
	assertImportableMarkdownPath(normalizedPath.posixPath);

	let resolvedWorkspacePath: string;
	try {
		resolvedWorkspacePath = await realpath(workspacePath);
	} catch {
		throw createWorkspaceFileReadError("INTERNAL_SERVER_ERROR", "Workspace path is unavailable.");
	}

	const requestedPath = resolve(resolvedWorkspacePath, normalizedPath.platformPath);
	let resolvedFilePath: string;
	try {
		resolvedFilePath = await realpath(requestedPath);
	} catch (error) {
		const errorCode = error instanceof Error && "code" in error ? error.code : undefined;
		if (errorCode === "ENOENT" || errorCode === "ENOTDIR") {
			throw createWorkspaceFileReadError("NOT_FOUND", "Workspace file not found.");
		}
		throw createWorkspaceFileReadError("INTERNAL_SERVER_ERROR", "Unable to access workspace file.");
	}

	if (!isPathInsideWorkspace(resolvedWorkspacePath, resolvedFilePath)) {
		throw createWorkspaceFileReadError("BAD_REQUEST", "File path must stay within the workspace.");
	}

	let fileStats: Stats;
	try {
		fileStats = await stat(resolvedFilePath);
	} catch {
		throw createWorkspaceFileReadError("INTERNAL_SERVER_ERROR", "Unable to inspect workspace file.");
	}
	if (!fileStats.isFile()) {
		throw createWorkspaceFileReadError("BAD_REQUEST", "File path must point to a file.");
	}
	if (fileStats.size > MAX_WORKSPACE_MARKDOWN_FILE_BYTES) {
		throw createWorkspaceFileReadError("BAD_REQUEST", "Markdown file is too large to import.");
	}

	try {
		const content = await readFile(resolvedFilePath, "utf8");
		return {
			path: normalizedPath.posixPath,
			content,
		};
	} catch {
		throw createWorkspaceFileReadError("INTERNAL_SERVER_ERROR", "Unable to read workspace file.");
	}
}
