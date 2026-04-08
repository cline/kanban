import { access, mkdir, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { runGit } from "./git-utils.js";

export interface GitCloneResult {
	ok: boolean;
	clonedPath: string;
	error?: string;
}

/**
 * Derive a repository name from a Git URL.
 *
 * Handles HTTPS URLs (e.g. `https://github.com/user/repo.git`),
 * SSH URLs (e.g. `git@github.com:user/repo.git`), and bare names.
 * Strips a trailing `.git` suffix if present.
 */
export function deriveRepoNameFromUrl(gitUrl: string): string | null {
	const trimmed = gitUrl.trim().replace(/\/+$/, "");
	if (!trimmed) {
		return null;
	}

	// Handle SSH-style URLs: git@host:user/repo.git
	const sshMatch = trimmed.match(/^[^@]+@[^:]+:(.+)$/);
	const pathPart = sshMatch?.[1] ?? trimmed;

	// Take the last path segment.
	const lastSegment = basename(pathPart);
	if (!lastSegment) {
		return null;
	}

	// Strip trailing .git
	const name = lastSegment.endsWith(".git") ? lastSegment.slice(0, -4) : lastSegment;
	return name || null;
}

/**
 * Validate that a resolved destination path is within the server CWD sandbox.
 * Returns the resolved absolute path if valid, or throws an error.
 */
export function validateCloneDestination(destination: string, serverCwd: string): string {
	const resolved = resolve(destination);
	const normalizedCwd = serverCwd.endsWith("/") ? serverCwd : `${serverCwd}/`;
	if (resolved !== serverCwd && !resolved.startsWith(normalizedCwd)) {
		throw new Error(
			`Clone destination is outside the server working directory. Destination "${resolved}" must be within "${serverCwd}".`,
		);
	}
	return resolved;
}

/**
 * Clone a Git repository to a destination directory within the server CWD.
 *
 * @param gitUrl - The Git repository URL to clone.
 * @param serverCwd - The server's current working directory (sandbox root).
 * @param destinationPath - Optional custom destination path. If omitted, the
 *   clone is placed at `<serverCwd>/<repo-name>`.
 */
export async function cloneGitRepository(
	gitUrl: string,
	serverCwd: string,
	destinationPath?: string,
): Promise<GitCloneResult> {
	const repoName = deriveRepoNameFromUrl(gitUrl);
	if (!repoName && !destinationPath) {
		return {
			ok: false,
			clonedPath: "",
			error: "Could not derive repository name from URL and no destination path was provided.",
		};
	}

	// At this point either repoName or destinationPath is truthy (guarded above).
	const rawDestination = destinationPath ?? resolve(serverCwd, repoName as string);

	let clonePath: string;
	try {
		clonePath = validateCloneDestination(rawDestination, serverCwd);
	} catch (error) {
		return {
			ok: false,
			clonedPath: rawDestination,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	// If the destination already exists and is a directory, append the repo name
	// so the behavior matches native `git clone <url> <existing-dir>` — the repo
	// is cloned *into* the directory rather than rejected outright.
	try {
		await access(clonePath);
		const destStat = await stat(clonePath);
		if (destStat.isDirectory() && repoName) {
			const nestedPath = resolve(clonePath, repoName);
			try {
				clonePath = validateCloneDestination(nestedPath, serverCwd);
			} catch (error) {
				return {
					ok: false,
					clonedPath: nestedPath,
					error: error instanceof Error ? error.message : String(error),
				};
			}
			// Verify the nested destination doesn't already exist.
			try {
				await access(clonePath);
				return {
					ok: false,
					clonedPath: clonePath,
					error: `Destination already exists: "${clonePath}".`,
				};
			} catch {
				// Good — the nested path does not exist yet.
			}
		} else {
			return {
				ok: false,
				clonedPath: clonePath,
				error: `Destination already exists: "${clonePath}".`,
			};
		}
	} catch {
		// Expected: destination does not exist yet.
	}

	// Ensure the parent directory exists.
	const parentDir = dirname(clonePath);
	try {
		await mkdir(parentDir, { recursive: true });
	} catch (error) {
		return {
			ok: false,
			clonedPath: clonePath,
			error: `Failed to create parent directory "${parentDir}": ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	// Run `git clone <url> <destination>`.
	// The cwd for the git process should be the parent directory of the destination.
	const result = await runGit(parentDir, ["clone", "--", gitUrl, clonePath]);
	if (!result.ok) {
		return {
			ok: false,
			clonedPath: clonePath,
			error: result.error ?? `Git clone failed: ${result.stderr || result.output}`,
		};
	}

	return {
		ok: true,
		clonedPath: clonePath,
	};
}
