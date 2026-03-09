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
		binary: "bash",
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
