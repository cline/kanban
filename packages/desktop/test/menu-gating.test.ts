import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Source-code structural verification for menu/command gating (Task 11).
// ---------------------------------------------------------------------------

const mainSrc = readFileSync(
	new URL("../src/main.ts", import.meta.url),
	"utf-8",
);

function extractFunctionBody(name: string): string {
	const lines = mainSrc.split("\n");
	const startIdx = lines.findIndex((l) =>
		l.includes(`function ${name}(`),
	);
	if (startIdx === -1) throw new Error(`Function "${name}" not found`);

	let depth = 0;
	let started = false;
	const collected: string[] = [];
	for (let i = startIdx; i < lines.length; i++) {
		for (const ch of lines[i]) {
			if (ch === "{") { depth++; started = true; }
			if (ch === "}") depth--;
		}
		collected.push(lines[i]);
		if (started && depth === 0) break;
	}
	return collected.join("\n");
}

// ---------------------------------------------------------------------------
// isRuntimeAvailable
// ---------------------------------------------------------------------------

describe("isRuntimeAvailable", () => {
	const fnBody = extractFunctionBody("isRuntimeAvailable");

	it("exists and returns a boolean", () => {
		expect(fnBody).toContain("function isRuntimeAvailable(): boolean");
	});

	it("returns false when connectionManager is null", () => {
		expect(fnBody).toContain("if (!connectionManager) return false");
	});

	it("returns false when failureCode is set", () => {
		expect(fnBody).toContain("boot.failureCode");
		expect(fnBody).toContain("return false");
	});

	it("returns false when not in ready phase", () => {
		expect(fnBody).toMatch(/boot\.currentPhase\s*!==\s*"ready"/);
	});

	it("returns true when ready and no failure", () => {
		expect(fnBody).toContain("return true");
	});
});

// ---------------------------------------------------------------------------
// buildMenuTemplate gating
// ---------------------------------------------------------------------------

describe("buildMenuTemplate gating", () => {
	const fnBody = extractFunctionBody("buildMenuTemplate");

	it("calls isRuntimeAvailable to compute runtimeReady", () => {
		expect(fnBody).toMatch(/const runtimeReady\s*=\s*isRuntimeAvailable\(\)/);
	});

	// Runtime-dependent items gated
	for (const role of [
		"reload", "forceReload", "resetZoom", "zoomIn", "zoomOut",
		"undo", "redo", "cut", "copy", "paste", "selectAll",
	]) {
		it(`gates ${role} with runtimeReady`, () => {
			expect(fnBody).toMatch(
				new RegExp(`role:\\s*"${role}".*enabled:\\s*runtimeReady`),
			);
		});
	}

	// Always-enabled items NOT gated
	for (const item of [
		{ role: "toggleDevTools", label: "toggleDevTools" },
		{ role: "togglefullscreen", label: "togglefullscreen" },
		{ role: "about", label: "about" },
		{ role: "quit", label: "quit" },
		{ role: "minimize", label: "minimize" },
	]) {
		it(`does NOT gate ${item.label}`, () => {
			const line = fnBody.split("\n").find((l) => l.includes(`"${item.role}"`));
			expect(line).toBeDefined();
			expect(line).not.toContain("runtimeReady");
		});
	}

	it("does NOT gate Diagnostics", () => {
		const line = fnBody.split("\n").find((l) => l.includes('"Diagnostics"'));
		expect(line).toBeDefined();
		expect(line).not.toContain("runtimeReady");
	});
});

// ---------------------------------------------------------------------------
// rebuildConnectionMenu rebuilds the base menu template
// ---------------------------------------------------------------------------

describe("rebuildConnectionMenu rebuilds base menu", () => {
	const fnBody = extractFunctionBody("rebuildConnectionMenu");

	it("builds a new menu from buildMenuTemplate()", () => {
		expect(fnBody).toContain("buildMenuTemplate()");
		expect(fnBody).toContain("Menu.buildFromTemplate");
	});

	it("sets the application menu", () => {
		expect(fnBody).toContain("Menu.setApplicationMenu");
	});

	it("installs the connection menu on top", () => {
		expect(fnBody).toContain("installConnectionMenu");
	});
});

// ---------------------------------------------------------------------------
// Menu is rebuilt on boot state transitions
// ---------------------------------------------------------------------------

describe("menu rebuild on boot state transitions", () => {
	it("rebuilds after advanceBootPhase('ready') in startup", () => {
		const block = mainSrc.slice(
			mainSrc.indexOf("await connectionManager.initialize()"),
		);
		const readyIdx = block.indexOf('advanceBootPhase("ready")');
		const rebuildIdx = block.indexOf("rebuildConnectionMenu()", readyIdx);
		expect(rebuildIdx).toBeGreaterThan(readyIdx);
	});

	it("rebuilds after recordBootFailure in startup catch block", () => {
		const catchBlock = mainSrc.slice(
			mainSrc.indexOf('recordBootFailure("UNKNOWN_STARTUP_FAILURE", message)'),
		);
		const rebuildIdx = catchBlock.indexOf("rebuildConnectionMenu()");
		expect(rebuildIdx).toBeGreaterThan(0);
	});

	it("rebuilds in else branch when failure code is set after initialize", () => {
		// Use the unique comment from the startup path to anchor the search
		const anchor = "source of truth for whether boot succeeded";
		const anchorIdx = mainSrc.indexOf(anchor);
		expect(anchorIdx).toBeGreaterThan(-1);
		const block = mainSrc.slice(anchorIdx, anchorIdx + 500);
		expect(block).toContain("else {");
		const elseBranch = block.slice(block.indexOf("else {"));
		expect(elseBranch).toContain("rebuildConnectionMenu()");
	});

	it("rebuilds during restartRuntimeChild after resetBootState", () => {
		const body = extractFunctionBody("restartRuntimeChild");
		const resetIdx = body.indexOf("resetBootState()");
		const rebuildIdx = body.indexOf("rebuildConnectionMenu()", resetIdx);
		expect(rebuildIdx).toBeGreaterThan(resetIdx);
	});

	it("rebuilds at end of restartRuntimeChild after initialize", () => {
		const body = extractFunctionBody("restartRuntimeChild");
		const initIdx = body.indexOf("await connectionManager.initialize()");
		const rebuildIdx = body.indexOf("rebuildConnectionMenu()", initIdx);
		expect(rebuildIdx).toBeGreaterThan(initIdx);
	});
});
