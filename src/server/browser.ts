import open from "open";
import { isBinaryAvailableOnPath } from "../terminal/command-discovery.js";

type BrowserOpenDeps = {
	warn?: (message: string) => void;
	openUrl?: typeof open;
	platform?: NodeJS.Platform;
	isBinaryAvailable?: (binary: string) => boolean;
};

export function openInBrowser(url: string, deps?: BrowserOpenDeps): void {
	const warn = deps?.warn ?? (() => {});
	const openUrl = deps?.openUrl ?? open;
	const platform = deps?.platform ?? process.platform;
	const isBinaryAvailable = deps?.isBinaryAvailable ?? isBinaryAvailableOnPath;

	// On Linux the `open` package ships a bundled xdg-open fallback.
	// Prefer system xdg-open when present so PATH-based overrides still work.
	const options =
		platform === "linux" && isBinaryAvailable("xdg-open")
			? { app: { name: "xdg-open" } }
			: undefined;

	void openUrl(url, options).catch(() => {
		warn(`Could not open browser automatically. Open this URL manually: ${url}`);
	});
}
