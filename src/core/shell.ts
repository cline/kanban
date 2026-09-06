import { isBinaryAvailableOnPath } from "../terminal/command-discovery";

const WINDOWS_SHELL_CANDIDATES = ["cmd.exe", "powershell.exe", "pwsh"] as const;
const POSIX_SHELL_CANDIDATES = ["bash", "zsh", "fish", "sh"] as const;

function getShellFamily(binary: string): string {
	const baseName = binary.replaceAll("\\", "/").split("/").at(-1) ?? binary;
	return baseName.toLowerCase().replace(/\.(exe|com|cmd|bat)$/, "");
}

export function getInteractiveShellArgs(binary: string): string[] {
	const family = getShellFamily(binary);
	if (family === "cmd") {
		return [];
	}
	if (family === "powershell" || family === "pwsh") {
		return ["-NoLogo"];
	}
	if ((POSIX_SHELL_CANDIDATES as readonly string[]).includes(family)) {
		return ["-i"];
	}
	// Unknown shells: no flags on Windows, interactive flag elsewhere to match
	// the historical $SHELL launch behavior.
	if (process.platform === "win32") {
		return [];
	}
	return ["-i"];
}

export function resolveInteractiveShellCommand(preferredShell?: string | null): { binary: string; args: string[] } {
	// A configured shell that disappeared from PATH (uninstalled, PATH change)
	// silently falls back to the environment default instead of failing the
	// terminal; the session response reports the shell that actually ran.
	const preferred = preferredShell?.trim();
	if (preferred && isBinaryAvailableOnPath(preferred)) {
		return {
			binary: preferred,
			args: getInteractiveShellArgs(preferred),
		};
	}

	if (process.platform === "win32") {
		const command = process.env.COMSPEC?.trim();
		if (command) {
			return {
				binary: command,
				args: [],
			};
		}
		return {
			binary: "powershell.exe",
			args: ["-NoLogo"],
		};
	}

	const command = process.env.SHELL?.trim();
	if (command) {
		return {
			binary: command,
			args: ["-i"],
		};
	}
	return {
		binary: "bash",
		args: ["-i"],
	};
}

export function detectAvailableShells(): string[] {
	const candidates: (string | undefined)[] =
		process.platform === "win32"
			? [process.env.COMSPEC?.trim(), ...WINDOWS_SHELL_CANDIDATES]
			: [process.env.SHELL?.trim(), ...POSIX_SHELL_CANDIDATES];
	const detected: string[] = [];
	const seenFamilies = new Set<string>();
	for (const candidate of candidates) {
		if (!candidate) {
			continue;
		}
		const family = getShellFamily(candidate);
		if (seenFamilies.has(family) || !isBinaryAvailableOnPath(candidate)) {
			continue;
		}
		seenFamilies.add(family);
		detected.push(candidate);
	}
	return detected;
}

export function quoteShellArg(value: string): string {
	if (process.platform === "win32") {
		return `"${value.replaceAll('"', '""')}"`;
	}
	return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildShellCommandLine(binary: string, args: string[]): string {
	return [binary, ...args].map((part) => quoteShellArg(part)).join(" ");
}
