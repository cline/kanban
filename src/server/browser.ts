import { spawn } from "node:child_process";

type BrowserOpenDeps = {
	platform: NodeJS.Platform;
	spawnProcess: typeof spawn;
	warn: (message: string) => void;
};

function getOpenCommandCandidates(platform: NodeJS.Platform, url: string): Array<{ command: string; args: string[] }> {
	if (platform === "darwin") {
		return [{ command: "open", args: [url] }];
	}
	if (platform === "win32") {
		return [{ command: "cmd", args: ["/c", "start", "", url] }];
	}
	return [
		{ command: "xdg-open", args: [url] },
		{ command: "gio", args: ["open", url] },
		{ command: "sensible-browser", args: [url] },
	];
}

function formatBrowserOpenError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

export function openInBrowser(url: string, deps?: Partial<BrowserOpenDeps>): void {
	const platform = deps?.platform ?? process.platform;
	const spawnProcess = deps?.spawnProcess ?? spawn;
	const warn = deps?.warn ?? (() => {});

	const candidates = getOpenCommandCandidates(platform, url);

	const launchCandidate = (index: number): void => {
		if (index >= candidates.length) {
			warn(`Could not open browser automatically. Open this URL manually: ${url}`);
			return;
		}

		const candidate = candidates[index];

		try {
			const child = spawnProcess(candidate.command, candidate.args, { detached: true, stdio: "ignore" });
			child.once("error", (error) => {
				const code = typeof error === "object" && error && "code" in error ? String(error.code) : null;
				if (code === "ENOENT") {
					launchCandidate(index + 1);
					return;
				}
				warn(
					`Could not open browser automatically via ${candidate.command}: ${formatBrowserOpenError(error)}. Open this URL manually: ${url}`,
				);
			});
			child.unref();
		} catch (error) {
			const code = typeof error === "object" && error && "code" in error ? String(error.code) : null;
			if (code === "ENOENT") {
				launchCandidate(index + 1);
				return;
			}
			warn(
				`Could not open browser automatically via ${candidate.command}: ${formatBrowserOpenError(error)}. Open this URL manually: ${url}`,
			);
		}
	};

	launchCandidate(0);
}
