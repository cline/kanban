/**
 * Resolve the default fallback shell binary as an absolute path.
 *
 * When `process.env.SHELL` is not set (common for macOS GUI apps launched via
 * launchd, where the environment is minimal), we need a reliable absolute path
 * so that `posix_spawn` can find the binary without depending on `PATH`.
 */
function resolveUnixFallbackShell(): string {
	if (process.platform === "darwin") {
		// macOS default shell since Catalina
		return "/bin/zsh";
	}
	return "/bin/bash";
}

export function resolveInteractiveShellCommand(): { binary: string; args: string[] } {
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
		binary: resolveUnixFallbackShell(),
		args: ["-i"],
	};
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
