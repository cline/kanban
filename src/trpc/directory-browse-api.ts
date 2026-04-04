import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

import { TRPCError } from "@trpc/server";

import type { RuntimeListDirectoriesRequest, RuntimeListDirectoriesResponse } from "../core/api-contract";

export interface CreateDirectoryBrowseApiDependencies {
	directoryBrowseRoot?: string;
}

export interface DirectoryBrowseApi {
	listDirectories: (input: RuntimeListDirectoriesRequest) => Promise<RuntimeListDirectoriesResponse>;
}

function ensureTrailingSep(dirPath: string): string {
	return dirPath.endsWith(sep) ? dirPath : dirPath + sep;
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
	const normalizedCandidate = resolve(candidatePath);
	const normalizedRoot = resolve(rootPath);
	if (normalizedCandidate === normalizedRoot) {
		return true;
	}
	return normalizedCandidate.startsWith(ensureTrailingSep(normalizedRoot));
}

export function createDirectoryBrowseApi(deps: CreateDirectoryBrowseApiDependencies): DirectoryBrowseApi {
	const browseRoot = deps.directoryBrowseRoot ?? homedir();

	return {
		listDirectories: async (input) => {
			const requestedPath = resolve(input.path);

			if (!isWithinRoot(requestedPath, browseRoot)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Path is outside the allowed browse root.",
				});
			}

			let entries: string[];
			try {
				entries = await readdir(requestedPath);
			} catch (error) {
				if (error instanceof Error && "code" in error) {
					const nodeError = error as NodeJS.ErrnoException;
					if (nodeError.code === "ENOENT") {
						throw new TRPCError({
							code: "NOT_FOUND",
							message: `Directory not found: ${requestedPath}`,
						});
					}
					if (nodeError.code === "EACCES" || nodeError.code === "EPERM") {
						throw new TRPCError({
							code: "FORBIDDEN",
							message: `Permission denied: ${requestedPath}`,
						});
					}
					if (nodeError.code === "ENOTDIR") {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `Not a directory: ${requestedPath}`,
						});
					}
				}
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: `Failed to read directory: ${requestedPath}`,
				});
			}

			const directories: Array<{ name: string; path: string }> = [];
			for (const entry of entries) {
				const entryPath = join(requestedPath, entry);
				try {
					const entryStat = await stat(entryPath);
					if (entryStat.isDirectory()) {
						directories.push({
							name: entry,
							path: entryPath,
						});
					}
				} catch {
					// Skip entries we cannot stat (e.g. broken symlinks, permission errors)
				}
			}

			directories.sort((a, b) => a.name.localeCompare(b.name));

			return { directories };
		},
	};
}
