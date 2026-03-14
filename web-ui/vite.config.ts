import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ResolvedConfig, transformWithEsbuild } from "vite";

const rootPkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8")) as { version: string };
const XTERM_CHUNK_NAME = "xterm-vendor";

function isXtermModule(id: string): boolean {
	return id.includes("/node_modules/@xterm/") || id.includes("\\node_modules\\@xterm\\");
}

function selectiveBuildMinifyPlugin(): Plugin {
	let resolvedConfig: ResolvedConfig | null = null;

	return {
		name: "kanban-selective-build-minify",
		apply: "build",
		configResolved(config) {
			resolvedConfig = config;
		},
		async renderChunk(code, chunk, outputOptions) {
			if (!resolvedConfig || !chunk.fileName.endsWith(".js")) {
				return null;
			}
			if (Object.keys(chunk.modules).some((id) => isXtermModule(id))) {
				return null;
			}
			const minified = await transformWithEsbuild(
				code,
				chunk.fileName,
				{
					format: outputOptions.format === "cjs" ? "cjs" : "esm",
					minify: true,
					sourcemap: Boolean(resolvedConfig.build.sourcemap),
					treeShaking: true,
				},
				undefined,
				resolvedConfig,
			);
			return {
				code: minified.code,
				map: minified.map ?? null,
			};
		},
	};
}

export default defineConfig({
	// OpenCode broke in production because esbuild minification corrupted xterm's
	// requestMode handling. We isolate all @xterm code into its own chunk and leave
	// that chunk unminified, while still minifying the rest of the app here.
	// Compared with leaving the entire frontend unminified, this saves about
	// 770 KB raw and 108.5 KB gzipped across emitted frontend assets.
	// Compared with fully minifying everything, this costs about 545 KB raw and
	// 58.5 KB gzipped, which is the current tradeoff for keeping OpenCode stable.
	plugins: [tailwindcss(), react(), selectiveBuildMinifyPlugin()],
	envPrefix: ["VITE_", "POSTHOG_"],
	define: {
		__APP_VERSION__: JSON.stringify(rootPkg.version),
	},
	build: {
		// esbuild minification corrupts xterm's DECRQM requestMode helper in the
		// production bundle, which breaks full-screen TUIs like OpenCode at runtime.
		// Keep xterm unminified, but selectively minify the rest of the app below.
		minify: false,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (isXtermModule(id)) {
						return XTERM_CHUNK_NAME;
					}
					return undefined;
				},
			},
		},
	},
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
			"@runtime-agent-catalog": resolve(__dirname, "../src/core/agent-catalog.ts"),
			"@runtime-shortcuts": resolve(__dirname, "../src/config/shortcut-utils.ts"),
			"@runtime-task-id": resolve(__dirname, "../src/core/task-id.ts"),
			"@runtime-task-state": resolve(__dirname, "../src/core/task-board-mutations.ts"),
		},
	},
	server: {
		host: "127.0.0.1",
		port: 4173,
		strictPort: true,
		proxy: {
			"/api": {
				target: "http://127.0.0.1:3484",
				changeOrigin: true,
				ws: true
			},
		},
	},
});
