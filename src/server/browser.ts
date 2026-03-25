import { spawn } from "node:child_process";
import open from "open";

type BrowserOpenDeps = {
	warn: (message: string) => void;
};

export function openInBrowser(url: string, deps?: BrowserOpenDeps): void {
	try {
		open(url)
	} catch(err) {
		const warn = deps?.warn ?? (() => {});
		warn(`Could not open browser automatically. Open this URL manually: ${url}`);
	}
}
