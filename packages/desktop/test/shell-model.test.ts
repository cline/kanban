import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Structural verification that main.ts implements the four shell-model
 * behaviors. These tests read the source code and verify the expected
 * patterns exist — they don't execute Electron APIs.
 *
 * Shell model:
 *   1. Attach to existing runtime on configured endpoint
 *   2. Start runtime if endpoint is down
 *   3. Show disconnected screen + restart after disconnect
 *   4. Multi-window loads same runtime URL
 */

const mainSrc = readFileSync(
	new URL("../src/main.ts", import.meta.url),
	"utf-8",
);

// ---------------------------------------------------------------------------
// 1. Attach to existing runtime
// ---------------------------------------------------------------------------

describe("attach to existing runtime", () => {
	it("health-checks the default endpoint before starting a child", () => {
		// The boot flow should check health on the default origin first.
		expect(mainSrc).toContain("checkHealth(defaultOrigin)");
	});

	it("sets runtimeUrl to the existing runtime when healthy", () => {
		// When an external runtime is found, we attach to it.
		expect(mainSrc).toContain("runtimeUrl = defaultOrigin");
		expect(mainSrc).toContain("ownsChild = false");
	});

	it("loads the external runtime URL into all windows", () => {
		expect(mainSrc).toContain("windowRegistry.loadUrlInAllWindows(runtimeUrl)");
	});
});

// ---------------------------------------------------------------------------
// 2. Start runtime if missing
// ---------------------------------------------------------------------------

describe("start runtime if missing", () => {
	it("calls startOwnRuntime when no existing runtime is found", () => {
		// The else branch after checkHealth should start our own runtime.
		expect(mainSrc).toContain("await startOwnRuntime()");
	});

	it("creates a RuntimeChildManager with start/heartbeat/restart config", () => {
		expect(mainSrc).toContain("new RuntimeChildManager(");
		expect(mainSrc).toContain("maxRestarts: 3");
		expect(mainSrc).toContain("heartbeatTimeoutMs:");
	});

	it("sets ownsChild = true after starting", () => {
		expect(mainSrc).toContain("ownsChild = true");
	});

	it("sets an auth cookie for seamless web UI authentication", () => {
		expect(mainSrc).toContain('name: "kanban-auth"');
		expect(mainSrc).toContain("setAuthCookie(");
	});
});

// ---------------------------------------------------------------------------
// 3. Restart after disconnect
// ---------------------------------------------------------------------------

describe("restart after disconnect", () => {
	it("shows disconnected screen when max restarts exceeded", () => {
		expect(mainSrc).toContain('"maximum restart attempts"');
		expect(mainSrc).toContain("showDisconnectedScreen()");
	});

	it("shows disconnected screen when runtime health check fails on did-fail-load", () => {
		// The did-fail-load handler checks health and shows disconnected screen.
		expect(mainSrc).toContain("did-fail-load");
		expect(mainSrc).toContain("checkHealth(origin)");
	});

	it("has a disconnected HTML page with a restart button", () => {
		const disconnectedHtml = readFileSync(
			new URL("../src/disconnected.html", import.meta.url),
			"utf-8",
		);
		expect(disconnectedHtml).toContain("Runtime Disconnected");
		expect(disconnectedHtml).toContain("restartRuntime");
		expect(disconnectedHtml).toContain("<code>kanban</code>");
	});

	it("handles restart-runtime IPC from the disconnected screen", () => {
		expect(mainSrc).toContain('"restart-runtime"');
		expect(mainSrc).toContain("void restartRuntime()");
	});

	it("nulls out runtimeManager before restart to reset restart counter", () => {
		expect(mainSrc).toContain("runtimeManager = null");
		expect(mainSrc).toContain("reset restart counter");
	});

	it("deduplicates concurrent restart calls via restartPromise", () => {
		expect(mainSrc).toContain("restartPromise");
	});
});

// ---------------------------------------------------------------------------
// 4. Multi-window loads same URL
// ---------------------------------------------------------------------------

describe("multi-window same URL", () => {
	it("creates windows via windowRegistry.createWindow", () => {
		expect(mainSrc).toContain("windowRegistry.createWindow(");
	});

	it("loads the same runtimeUrl in new windows", () => {
		// createAppWindow loads the current runtimeUrl.
		expect(mainSrc).toContain("window.loadURL(url)");
	});

	it("has a New Window menu accelerator", () => {
		expect(mainSrc).toContain('"New Window"');
		expect(mainSrc).toContain("CmdOrCtrl+Shift+N");
	});

	it("supports --project flag to open project-specific windows", () => {
		expect(mainSrc).toContain('parseProjectFromArgv');
		expect(mainSrc).toContain("open-project-window");
	});

	it("handles second-instance by focusing existing or opening new window", () => {
		expect(mainSrc).toContain('"second-instance"');
		expect(mainSrc).toContain("requestSingleInstanceLock");
	});
});

// ---------------------------------------------------------------------------
// Bonus: no leftover multi-runtime concepts
// ---------------------------------------------------------------------------

describe("no leftover multi-runtime concepts", () => {
	it("does not import ConnectionManager", () => {
		// Check for actual import statement, not substring matches
		// (RuntimeChildManager and comments naturally contain partial matches)
		expect(mainSrc).not.toMatch(/import\s.*ConnectionManager/);
		expect(mainSrc).not.toMatch(/from\s+["'].*connection-manager/);
	});

	it("does not import ConnectionStore", () => {
		expect(mainSrc).not.toMatch(/import\s.*ConnectionStore/);
		expect(mainSrc).not.toMatch(/from\s+["'].*connection-store/);
	});

	it("does not reference runtime descriptors", () => {
		expect(mainSrc).not.toContain("readRuntimeDescriptor");
		expect(mainSrc).not.toContain("writeRuntimeDescriptor");
		expect(mainSrc).not.toContain("clearRuntimeDescriptor");
		expect(mainSrc).not.toContain("evaluateDescriptorTrust");
	});

	it("does not reference takeover or failover", () => {
		expect(mainSrc).not.toContain("handleRuntimeDisconnect");
		expect(mainSrc).not.toContain("descriptorWatcher");
	});

	it("does not have desktop boot state machine", () => {
		expect(mainSrc).not.toContain("advanceBootPhase");
		expect(mainSrc).not.toContain("recordBootFailure");
		expect(mainSrc).not.toContain("getBootState");
	});
});
