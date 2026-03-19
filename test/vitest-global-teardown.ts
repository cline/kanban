import { stop as stopEsbuild } from "esbuild";
import { logActiveResources, shouldLogNode22CiDiagnostics } from "./vitest-node22-ci-diagnostics.js";

// Node 22 changed stream.pipeline() to wait for the "close" event before
// completing (nodejs/node#53462). The esbuild child process that vite spawns
// for TypeScript transforms holds stdio handles open indefinitely, which
// prevents the Node event loop from draining after tests finish. Explicitly
// stopping esbuild releases those handles so vitest can exit cleanly.
//
// On Node 20 (and locally on Node 22 with faster shutdown timing), vitest
// exits before this becomes a problem. In CI on Node 22, the slower runner
// timing consistently triggers the hang.
export async function teardown(): Promise<void> {
	if (shouldLogNode22CiDiagnostics()) {
		logActiveResources("before esbuild.stop()");
	}
	await stopEsbuild();
	await new Promise<void>((resolve) => {
		setTimeout(resolve, 50);
	});
	if (shouldLogNode22CiDiagnostics()) {
		logActiveResources("after esbuild.stop()");
		process.exit(process.exitCode ?? 0);
	}
}
