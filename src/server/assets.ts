import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".map": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
};

export interface RuntimeAsset {
	content: Buffer;
	contentType: string;
}

export function getWebUiDir(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	// Bundled output (dist/cli.js): web-ui is at dist/web-ui
	const bundledPath = resolve(here, "web-ui");
	// tsc output (dist/server/assets.js): web-ui is at dist/../web-ui → dist/web-ui
	const packagedBuildPath = resolve(here, "../web-ui");
	const repoBuildPath = resolve(here, "../../web-ui/dist");
	const repoSourcePath = resolve(here, "../../web-ui");
	const hasAssets = (dir: string) =>
		existsSync(join(dir, "index.html")) && existsSync(join(dir, "assets"));
	if (hasAssets(bundledPath)) {
		return bundledPath;
	}
	if (hasAssets(packagedBuildPath)) {
		return packagedBuildPath;
	}
	if (hasAssets(repoBuildPath)) {
		return repoBuildPath;
	}
	return repoSourcePath;
}

function shouldFallbackToIndexHtml(pathname: string): boolean {
	return !extname(pathname);
}

export function normalizeRequestPath(urlPathname: string): string {
	const trimmed = urlPathname === "/" ? "/index.html" : urlPathname;
	return decodeURIComponent(trimmed.split("?")[0] ?? trimmed);
}

function resolveAssetPath(rootDir: string, urlPathname: string): string {
	const normalizedRequest = normalize(urlPathname).replace(/^(\.\.(\/|\\|$))+/, "");
	const absolutePath = resolve(rootDir, `.${normalizedRequest}`);
	const normalizedRoot = rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`;
	if (!absolutePath.startsWith(normalizedRoot)) {
		return resolve(rootDir, "index.html");
	}
	return absolutePath;
}

export async function readAsset(rootDir: string, requestPathname: string): Promise<RuntimeAsset> {
	let resolvedPath = resolveAssetPath(rootDir, requestPathname);

	try {
		const content = await readFile(resolvedPath);
		const extension = extname(resolvedPath).toLowerCase();
		return {
			content,
			contentType: MIME_TYPES[extension] ?? "application/octet-stream",
		};
	} catch (error) {
		if (!shouldFallbackToIndexHtml(requestPathname)) {
			throw error;
		}
		resolvedPath = resolve(rootDir, "index.html");
		const content = await readFile(resolvedPath);
		return {
			content,
			contentType: MIME_TYPES[".html"],
		};
	}
}
