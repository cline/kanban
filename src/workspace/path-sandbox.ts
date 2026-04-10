import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Check whether a candidate path is equal to or contained within a root path.
 *
 * Uses `path.resolve()` + `path.relative()` so the check works correctly on
 * both POSIX and Windows — unlike a naïve `startsWith(root + '/')` which
 * fails when the platform separator is `\`.
 *
 * @returns `true` when `candidatePath` is the same as or a descendant of `rootPath`.
 */
export function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
	const resolvedRoot = resolve(rootPath);
	const resolvedCandidate = resolve(candidatePath);

	// Exact match — candidate *is* the root.
	if (resolvedCandidate === resolvedRoot) {
		return true;
	}

	const rel = relative(resolvedRoot, resolvedCandidate);

	// `relative()` returns an empty string when the paths are identical (already
	// handled above), ".." or a path starting with ".." + sep when the candidate
	// escapes the root, or an absolute path on Windows when the paths are on
	// different drive letters.
	return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
