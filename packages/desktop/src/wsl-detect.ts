/**
 * WSL (Windows Subsystem for Linux) detection utilities.
 *
 * Pure utility functions — no Electron imports so they are safe to test
 * in a plain Node.js environment.
 *
 * On non-Windows platforms every function returns a "not available" result
 * immediately, making call-sites platform-agnostic.
 */

import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Describes a single WSL distribution. */
export interface WslDistro {
	/** Distribution name (e.g. "Ubuntu", "Debian"). */
	name: string;
	/** Whether this distro is the default for `wsl.exe`. */
	isDefault: boolean;
}

/** Result of probing the local system for WSL availability. */
export interface WslDetectionResult {
	/** `true` when WSL is available and at least one distro is installed. */
	available: boolean;
	/** Discovered WSL distributions (empty when WSL is unavailable). */
	distros: WslDistro[];
	/** Name of the default distribution, or `null` if none. */
	defaultDistro: string | null;
	/** Human-readable reason when WSL is *not* available. */
	unavailableReason?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The WSL executable path on Windows. */
const WSL_EXE = "wsl.exe";

// ---------------------------------------------------------------------------
// Internals — exported for testing
// ---------------------------------------------------------------------------

/**
 * Parse the output of `wsl.exe --list --verbose`.
 *
 * Example output (Windows console, UTF-16LE with BOM — we assume the caller
 * has already decoded to a JS string):
 *
 *     NAME            STATE           VERSION
 *   * Ubuntu          Running         2
 *     Debian          Stopped         2
 *
 * Returns the list of parsed distributions.
 */
export function parseWslListOutput(raw: string): WslDistro[] {
	const distros: WslDistro[] = [];
	const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

	// Skip the header line — it contains "NAME" or "STATE".
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		// Header detection: contains "NAME" and "STATE".
		if (/\bNAME\b/i.test(line) && /\bSTATE\b/i.test(line)) continue;

		// A default distro is prefixed with "* ".
		const isDefault = line.startsWith("*");
		// Strip leading "* " or whitespace, then take the first token as the name.
		const cleaned = line.replace(/^\*\s*/, "").trim();
		const name = cleaned.split(/\s+/)[0];
		if (!name) continue;

		distros.push({ name, isDefault });
	}

	return distros;
}

/**
 * Execute a command and return its stdout as a UTF-8 string.
 *
 * Abstracted so tests can provide a substitute via the `exec` option on
 * {@link detectWsl}.
 */
export type ExecFn = (cmd: string, args: string[]) => string;

const defaultExec: ExecFn = (cmd, args) =>
	execFileSync(cmd, args, {
		encoding: "utf-8",
		timeout: 10_000,
		stdio: ["ignore", "pipe", "ignore"],
	});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DetectWslOptions {
	/**
	 * Override `process.platform` — useful for testing the Windows code path
	 * on non-Windows hosts.
	 */
	platform?: NodeJS.Platform;
	/** Override the shell-exec function (for testing). */
	exec?: ExecFn;
}

/**
 * Detect whether WSL is available on this machine.
 *
 * On non-Windows platforms this returns `{ available: false }` immediately.
 * On Windows it shells out to `wsl.exe --list --verbose` and parses the
 * output.
 */
export function detectWsl(options?: DetectWslOptions): WslDetectionResult {
	const platform = options?.platform ?? process.platform;
	const exec = options?.exec ?? defaultExec;

	if (platform !== "win32") {
		return {
			available: false,
			distros: [],
			defaultDistro: null,
			unavailableReason: "WSL is only available on Windows.",
		};
	}

	// Check if wsl.exe exists by attempting `wsl.exe --status`.
	// `--status` is lightweight and returns quickly.
	try {
		exec(WSL_EXE, ["--status"]);
	} catch {
		return {
			available: false,
			distros: [],
			defaultDistro: null,
			unavailableReason:
				"WSL does not appear to be installed. Install it via 'wsl --install' in an elevated terminal.",
		};
	}

	// Enumerate installed distributions.
	let listOutput: string;
	try {
		listOutput = exec(WSL_EXE, ["--list", "--verbose"]);
	} catch {
		return {
			available: false,
			distros: [],
			defaultDistro: null,
			unavailableReason:
				"WSL is installed but no distributions could be listed. Run 'wsl --install' to set up a default distribution.",
		};
	}

	const distros = parseWslListOutput(listOutput);

	if (distros.length === 0) {
		return {
			available: false,
			distros: [],
			defaultDistro: null,
			unavailableReason:
				"WSL is installed but no Linux distributions were found. Run 'wsl --install' to set up a default distribution.",
		};
	}

	const defaultDistro =
		distros.find((d) => d.isDefault)?.name ?? distros[0]?.name ?? null;

	return {
		available: true,
		distros,
		defaultDistro,
	};
}

/**
 * Build a `spawn`-compatible command + args array for running a command
 * inside a specific WSL distribution.
 *
 * Example:
 * ```
 * buildWslCommand("Ubuntu", "npx", ["kanban", "--port", "auto"])
 * // → { file: "wsl.exe", args: ["-d", "Ubuntu", "--", "npx", "kanban", "--port", "auto"] }
 * ```
 */
export function buildWslCommand(
	distro: string,
	command: string,
	commandArgs: string[],
): { file: string; args: string[] } {
	return {
		file: WSL_EXE,
		args: ["-d", distro, "--", command, ...commandArgs],
	};
}
