import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// before-quit shutdown safety
//
// Regression tests for the macOS quit bug where a "Quit Kanban" from the
// app menu would leave an orphaned node process running because:
//   1. main.ts's before-quit handler didn't await the runtime shutdown
//      before calling app.quit().
//   2. orchestrator.shutdown() didn't catch errors from the underlying
//      manager.shutdown() and didn't always stop the power-save blocker.
//
// These are source-level structural assertions because the full quit flow
// requires a real Electron app. If either layer changes shape, these tests
// will catch it.
// ---------------------------------------------------------------------------

describe("before-quit shutdown safety", () => {
	const mainSrc = readFileSync(
		new URL("../src/main.ts", import.meta.url),
		"utf-8",
	);
	const orchestratorSrc = readFileSync(
		new URL("../src/runtime-orchestrator.ts", import.meta.url),
		"utf-8",
	);

	/** Extracts a handler body by scanning for a marker line + brace balancing. */
	function extractBlock(src: string, marker: string, label: string): string {
		const lines = src.split("\n");
		const startIdx = lines.findIndex((l) => l.includes(marker));
		if (startIdx === -1) throw new Error(`${label} not found`);

		let depth = 0;
		let started = false;
		const collected: string[] = [];
		for (let i = startIdx; i < lines.length; i++) {
			for (const ch of lines[i]) {
				if (ch === "{") {
					depth++;
					started = true;
				}
				if (ch === "}") depth--;
			}
			collected.push(lines[i]);
			if (started && depth === 0) break;
		}
		return collected.join("\n");
	}

	it("main.ts calls orchestrator.shutdown() then app.quit() after event.preventDefault()", () => {
		const handler = extractBlock(
			mainSrc,
			'app.on("before-quit"',
			"before-quit handler",
		);

		expect(handler).toContain("event.preventDefault()");
		expect(handler).toContain("orchestrator.shutdown()");
		expect(handler).toContain("app.quit()");

		// Order within the preventDefault branch: preventDefault → shutdown → quit.
		const preventIdx = handler.indexOf("event.preventDefault()");
		const shutdownIdx = handler.indexOf("orchestrator.shutdown()", preventIdx);
		const quitIdx = handler.indexOf("app.quit()", shutdownIdx);

		expect(shutdownIdx).toBeGreaterThan(preventIdx);
		expect(quitIdx).toBeGreaterThan(shutdownIdx);
	});

	it("before-quit calls preventDefault + shutdown unconditionally (no isOwned() gate)", () => {
		// Regression: a `if (orchestrator.isOwned())` gate around
		// preventDefault would let a mid-spawn quit fall through to
		// will-quit and orphan the child — `isOwned()` is false during
		// `await manager.start()`. Behavioral coverage lives in
		// runtime-orchestrator.test.ts ("shutdown() during connect()'s
		// startOwnRuntime() does not leak an orphan child").
		const handler = extractBlock(
			mainSrc,
			'app.on("before-quit"',
			"before-quit handler",
		);

		expect(handler).not.toMatch(/if\s*\(\s*orchestrator\.isOwned\s*\(\s*\)/);

		const preventIdx = handler.indexOf("event.preventDefault()");
		const awaitIdx = handler.indexOf("await orchestrator.shutdown()");
		expect(preventIdx).toBeGreaterThan(-1);
		expect(awaitIdx).toBeGreaterThan(preventIdx);
	});



	it("orchestrator.shutdown() catches and logs manager.shutdown errors", () => {
		const shutdownBody = extractBlock(
			orchestratorSrc,
			"async shutdown(): Promise<void>",
			"RuntimeOrchestrator.shutdown",
		);

		// manager.shutdown() must be wrapped so it never rejects — either
		// via try/catch or .catch(...). The log prefix lets grep-level
		// triage pin down startup hangs immediately.
		expect(shutdownBody).toContain("manager.shutdown()");
		expect(shutdownBody).toMatch(/\.catch\(|try\s*\{/);
		expect(shutdownBody).toContain("[desktop] Runtime shutdown error:");
	});

	it("orchestrator.shutdown() always stops the power-save blocker", () => {
		const shutdownBody = extractBlock(
			orchestratorSrc,
			"async shutdown(): Promise<void>",
			"RuntimeOrchestrator.shutdown",
		);

		// Called before manager.shutdown() so it runs even if there is no
		// owned child — and always before any awaited work that could hang.
		expect(shutdownBody).toContain("stopAppNapPrevention()");
		const stopIdx = shutdownBody.indexOf("stopAppNapPrevention()");
		const mgrIdx = shutdownBody.indexOf("manager.shutdown()");
		expect(stopIdx).toBeGreaterThan(-1);
		if (mgrIdx !== -1) expect(stopIdx).toBeLessThan(mgrIdx);
	});
});

// ---------------------------------------------------------------------------
// restart-runtime IPC concurrency guard
//
// Without the guard, two near-simultaneous "Restart" clicks (button-mash,
// or two windows with "Restart" hit at once) both call orchestrator.restart()
// and pop the failure dialog twice when the underlying spawn fails. Source-
// level structural test — the full IPC flow requires a real Electron app.
// ---------------------------------------------------------------------------

describe("restart-runtime IPC concurrency", () => {
	const mainSrc = readFileSync(
		new URL("../src/main.ts", import.meta.url),
		"utf-8",
	);

	it("main.ts coalesces concurrent restart-runtime IPCs via an in-flight latch", () => {
		// The guard must:
		//  1. Track the in-flight promise on a module-level reference.
		//  2. Early-return on the second IPC while the first is still
		//     outstanding (no nested orchestrator.restart() call).
		//  3. Clear the latch in `.finally` so a fresh restart can be
		//     requested after the previous one settles (success or failure).
		expect(mainSrc).toMatch(
			/let\s+activeRestart\s*:\s*Promise<void>\s*\|\s*null\s*=\s*null/,
		);
		// Body must check the latch *before* invoking orchestrator.restart().
		// The order matters: a check-after-call would still let two restarts
		// fire in parallel (the second would see the latch already cleared
		// because clearing happens synchronously after `.restart()` returns
		// the promise).
		const handlerStart = mainSrc.indexOf('ipcMain.on("restart-runtime"');
		expect(handlerStart).toBeGreaterThan(-1);
		const handlerSlice = mainSrc.slice(handlerStart, handlerStart + 1000);
		const guardIdx = handlerSlice.indexOf("if (activeRestart)");
		const restartCallIdx = handlerSlice.indexOf("orchestrator");
		expect(guardIdx).toBeGreaterThan(-1);
		expect(restartCallIdx).toBeGreaterThan(guardIdx);
		// Latch must be cleared in `.finally`, not just on success — a
		// failed restart must still allow the next click to retry.
		expect(handlerSlice).toMatch(/\.finally\(\(\)\s*=>\s*\{\s*activeRestart\s*=\s*null/);
	});
});

// ---------------------------------------------------------------------------
// OAuth relay: late-bound dialog focus
//
// `relayOAuthCallback` retries up to 3 times with 1s delays — worst case
// ~3 seconds before the failure dialog renders. If main.ts hands the relay
// a closure that captures the focused window at protocol-receive time
// (`getMainWindow: () => focusedWindow`), and the user switches focus
// during those retries, the dialog attaches to the wrong window. The
// closure must late-bind via `registry.getFocused()` instead.
// ---------------------------------------------------------------------------

describe("OAuth relay dialog focus is late-bound", () => {
	const mainSrc = readFileSync(
		new URL("../src/main.ts", import.meta.url),
		"utf-8",
	);

	it("passes a getMainWindow closure that re-queries the registry per call", () => {
		const callIdx = mainSrc.indexOf("relayOAuthCallback(");
		expect(callIdx).toBeGreaterThan(-1);
		const slice = mainSrc.slice(callIdx, callIdx + 500);

		// The closure must call into the registry on each invocation.
		expect(slice).toMatch(/getMainWindow:\s*\(\)\s*=>\s*registry\.getFocused\(\)/);
		// And specifically must NOT capture the snapshot variable.
		expect(slice).not.toMatch(/getMainWindow:\s*\(\)\s*=>\s*focusedWindow\b/);
	});
});
