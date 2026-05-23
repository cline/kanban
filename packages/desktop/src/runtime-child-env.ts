/**
 * Environment and PATH policy for the Kanban CLI subprocess.
 *
 * Isolated from runtime-child.ts so the process-lifecycle code stays
 * focused on spawn/poll/kill concerns. Two policy decisions live here:
 *
 *   1. Which env vars are forwarded to the child. All parent env vars
 *      are forwarded by default (matching VS Code's model). Agent shells
 *      inherit the full environment.
 *   2. Which platform-specific directories are appended to PATH. GUI-
 *      launched processes on macOS/Linux/Windows inherit a minimal PATH
 *      that typically omits Homebrew, npm-global, nvm, Git for Windows,
 *      etc. Agent shells need those binaries findable by name.
 */

import path, { join } from "node:path";

/**
 * Windows-specific PATH dirs that depend on per-user environment variables
 * (APPDATA / LOCALAPPDATA / ProgramFiles). Separated from the macOS/Linux
 * static list into a function purely for readability; the env vars are read
 * once when this module is imported, same as the POSIX constants below.
 */
function getWindowsExtraPathDirs(): string[] {
	const dirs: string[] = [];
	const localAppData = process.env.LOCALAPPDATA;
	const appData = process.env.APPDATA;
	const programFiles = process.env.ProgramFiles;
	const programFilesX86 = process.env["ProgramFiles(x86)"];
	if (appData) dirs.push(join(appData, "npm")); // npm global
	if (localAppData) {
		dirs.push(join(localAppData, "Programs", "nodejs"));
		// WinGet places shim executables in `…\WinGet\Links\` (not
		// `…\WinGet\Packages\`, which holds install directories that
		// aren't directly on PATH).
		dirs.push(join(localAppData, "Microsoft", "WinGet", "Links"));
	}
	if (programFiles) dirs.push(join(programFiles, "Git", "cmd"));
	if (programFilesX86) dirs.push(join(programFilesX86, "Git", "cmd"));
	return dirs;
}

/**
 * Directories appended to PATH for GUI-launched desktop processes.
 * macOS launchd and Linux desktop-file launches typically give minimal
 * PATHs; these ensure Homebrew, Snap, Git, etc. are findable.
 */
const EXTRA_PATH_DIRS: readonly string[] =
	process.platform === "darwin"
		? [
				"/opt/homebrew/bin",
				"/opt/homebrew/sbin",
				"/usr/local/bin",
				"/usr/local/sbin",
				"/usr/bin",
				"/bin",
				"/usr/sbin",
				"/sbin",
			]
		: process.platform === "linux"
			? ["/usr/local/bin", "/snap/bin", "/usr/bin", "/bin"]
			: process.platform === "win32"
				? getWindowsExtraPathDirs()
				: [];

/**
 * Build an enriched copy of process.env with PATH augmented for GUI-launched
 * processes. All parent environment variables are forwarded by default.
 */
export function buildFilteredEnv(): NodeJS.ProcessEnv {
	// Forward all parent env vars (matching VS Code's model)
	const filtered: NodeJS.ProcessEnv = { ...process.env };

	// Enrich PATH with common tool locations that GUI launches omit
	if (EXTRA_PATH_DIRS.length > 0) {
		const pathParts = new Set((filtered.PATH ?? "").split(path.delimiter).filter(Boolean));
		for (const dir of EXTRA_PATH_DIRS) pathParts.add(dir);
		filtered.PATH = [...pathParts].join(path.delimiter);
	}

	return filtered;
}
