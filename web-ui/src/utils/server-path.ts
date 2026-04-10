/**
 * Utilities for handling server paths that may use either forward slashes (Unix)
 * or backslashes (Windows).  Following the established codebase convention, all
 * helpers normalise backslashes to forward slashes first and then work
 * exclusively with "/".
 */

/**
 * Normalise a server path by replacing all backslashes with forward slashes.
 * This is the standard convention used across the codebase (path-display,
 * file-url, top-bar, is-binary-file-path, etc.).
 */
export function normalizeServerPath(pathValue: string): string {
	return pathValue.replaceAll("\\", "/");
}

/**
 * Split a server path into segments, normalising separators first.
 */
export function splitServerPath(pathValue: string): string[] {
	return normalizeServerPath(pathValue).split("/").filter(Boolean);
}

/**
 * Build an absolute server path by joining `rootPath` with a relative
 * `uiPath`.  Both inputs are normalised to "/" before joining.
 */
export function toServerAbsolute(rootPath: string, uiPath: string): string {
	const root = normalizeServerPath(rootPath).replace(/\/+$/, "");
	const parts = normalizeServerPath(uiPath).split("/").filter(Boolean);
	return [root, ...parts].join("/");
}

/**
 * Strip the `rootPath` prefix from an absolute path to get the relative
 * portion.  Returns an empty string when the paths are equal.
 */
export function toUiRelative(rootPath: string, absolutePath: string): string {
	const normalizedRoot = normalizeServerPath(rootPath).replace(/\/+$/, "");
	const normalizedAbsolute = normalizeServerPath(absolutePath);
	if (normalizedAbsolute === normalizedRoot) {
		return "";
	}
	const afterRoot = normalizedAbsolute.slice(normalizedRoot.length);
	return afterRoot.replace(/^\/+/, "");
}

/**
 * Produce a short display label for the server root breadcrumb.
 * For Windows paths like "C:/foo" it returns "C:/"; otherwise "/".
 */
export function serverRootLabel(rootPath: string): string {
	const normalized = normalizeServerPath(rootPath);
	const winDriveMatch = normalized.match(/^[A-Za-z]:\/?/);
	if (winDriveMatch) {
		const drive = winDriveMatch[0];
		return drive.endsWith("/") ? drive : `${drive}/`;
	}
	return "/";
}
