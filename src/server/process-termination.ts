import treeKill from "tree-kill";

interface TimeoutTerminatedChildProcess {
	pid?: number;
	kill: (signal?: NodeJS.Signals | number) => boolean;
}

type KillProcessTree = (pid: number, signal?: string, callback?: (error?: Error) => void) => void;

interface TerminateProcessForTimeoutOptions {
	platform?: NodeJS.Platform;
	killProcessTree?: KillProcessTree;
}

export function terminateProcessForTimeout(
	child: TimeoutTerminatedChildProcess,
	options: TerminateProcessForTimeoutOptions = {},
): void {
	const platform = options.platform ?? process.platform;
	if (platform === "win32") {
		child.kill();
		const pid = typeof child.pid === "number" ? child.pid : 0;
		if (pid > 0) {
			try {
				(options.killProcessTree ?? treeKill)(pid, "SIGTERM", () => {
					// Best effort only.
				});
			} catch {
				// Best effort only.
			}
		}
		return;
	}

	child.kill("SIGTERM");
}
