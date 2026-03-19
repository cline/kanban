import { defineConfig } from "vitest/config";
import vitestNode22CiReporter from "./test/vitest-node22-ci-reporter.js";

process.env.NODE_ENV = "production";

function currentNodeMajorVersion(): number | null {
	const majorVersion = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);
	return Number.isFinite(majorVersion) ? majorVersion : null;
}

function shouldSerializeNode22CiFiles(): boolean {
	if (!process.env.CI) {
		return false;
	}

	const majorVersion = currentNodeMajorVersion();
	return majorVersion !== null && majorVersion >= 22;
}

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@clinebot\/agents$/,
				replacement: "@clinebot/agents/node",
			},
			{
				find: /^@clinebot\/llms$/,
				replacement: "@clinebot/llms/node",
			},
		],
	},
	test: {
		globals: true,
		environment: "node",
		globalSetup: ["./test/vitest-global-teardown.ts"],
		reporters: ["default", vitestNode22CiReporter],
		// Node 22 CI hangs before `onTestRunEnd` with live `MessagePort` handles.
		// Serializing files there helps distinguish worker-pool shutdown issues
		// from test-level leaks while keeping local runs and Node 20 unchanged.
		fileParallelism: !shouldSerializeNode22CiFiles(),
		maxWorkers: shouldSerializeNode22CiFiles() ? 1 : undefined,
		exclude: ["apps/**", "web-ui/**", "third_party/**", "**/node_modules/**", "**/dist/**", ".worktrees/**"],
		testTimeout: 15_000,
		detectAsyncLeaks: true
	},
});
