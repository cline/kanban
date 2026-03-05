import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootPkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8")) as { version: string };

export default defineConfig({
	plugins: [react()],
	envPrefix: ["VITE_", "POSTHOG_"],
	define: {
		__APP_VERSION__: JSON.stringify(rootPkg.version),
	},
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
			"@runtime-shortcuts": resolve(__dirname, "../src/runtime/config/shortcut-utils.ts"),
			"@runtime-task-id": resolve(__dirname, "../src/runtime/task-id.ts"),
			"@runtime-task-state": resolve(__dirname, "../src/runtime/task-board-mutations.ts"),
		},
	},
	server: {
		host: "127.0.0.1",
		port: 4173,
		strictPort: true,
		proxy: {
			"/api": {
				target: "http://127.0.0.1:8484",
				changeOrigin: true,
			},
		},
	},
});
