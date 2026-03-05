import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
			"@runtime-task-id": resolve(__dirname, "../src/runtime/task-id.ts"),
			"@runtime-task-state": resolve(__dirname, "../src/runtime/task-board-mutations.ts"),
		},
	},
	test: {
		environment: "jsdom",
		include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
		passWithNoTests: true,
	},
});
