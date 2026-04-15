import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

const BUILD_BIN_DIR = path.resolve(import.meta.dirname, "..", "build", "bin");

describe("CLI shim (packaging level)", () => {
	it("build/bin/kanban exists and is executable", () => {
		const shimPath = path.join(BUILD_BIN_DIR, "kanban");
		expect(existsSync(shimPath)).toBe(true);
		const stat = statSync(shimPath);
		// Check owner-execute bit (0o100)
		expect(stat.mode & 0o111).toBeGreaterThan(0);
	});

	it("build/bin/kanban.cmd exists for Windows", () => {
		const shimPath = path.join(BUILD_BIN_DIR, "kanban.cmd");
		expect(existsSync(shimPath)).toBe(true);
	});

	it("macOS/Linux shim references the correct asar-unpacked entry point", () => {
		const shimPath = path.join(BUILD_BIN_DIR, "kanban");
		const content = readFileSync(shimPath, "utf-8");
		// Must reference the unpacked CLI entry, not a bare "kanban" binary
		expect(content).toContain("app.asar.unpacked/node_modules/kanban/dist/cli.js");
		// Must use node to run it
		expect(content).toContain("exec node");
	});

	it("Windows shim references the correct asar-unpacked entry point", () => {
		const shimPath = path.join(BUILD_BIN_DIR, "kanban.cmd");
		const content = readFileSync(shimPath, "utf-8");
		expect(content).toContain("app.asar.unpacked\\node_modules\\kanban\\dist\\cli.js");
		expect(content).toContain("node");
	});

	describe("shim invocation (simulated packaged layout)", () => {
		// Create a fake Electron Resources layout and verify the shim
		// actually runs node against the correct entry point.
		let fakeResourcesDir: string;
		let fakeCliEntry: string;
		let fakeShimPath: string;

		beforeAll(() => {
			fakeResourcesDir = path.join(tmpdir(), `kanban-shim-test-${Date.now()}`);
			const binDir = path.join(fakeResourcesDir, "bin");
			const cliDir = path.join(
				fakeResourcesDir,
				"app.asar.unpacked",
				"node_modules",
				"kanban",
				"dist",
			);
			mkdirSync(binDir, { recursive: true });
			mkdirSync(cliDir, { recursive: true });

			// Create a fake CLI entry point that prints a known marker
			fakeCliEntry = path.join(cliDir, "cli.js");
			writeFileSync(
				fakeCliEntry,
				`console.log("SHIM_TEST_OK:" + JSON.stringify(process.argv.slice(2)));`,
				"utf-8",
			);

			// Copy the real shim into the fake Resources/bin/
			const realShimContent = readFileSync(
				path.join(BUILD_BIN_DIR, "kanban"),
				"utf-8",
			);
			fakeShimPath = path.join(binDir, "kanban");
			writeFileSync(fakeShimPath, realShimContent, { mode: 0o755 });
		});

		afterAll(() => {
			if (fakeResourcesDir && existsSync(fakeResourcesDir)) {
				rmSync(fakeResourcesDir, { recursive: true, force: true });
			}
		});

		it("shim resolves CLI entry point and executes it", () => {
			// Skip on Windows (bash shim is macOS/Linux only)
			if (process.platform === "win32") {
				return;
			}

			const output = execFileSync(fakeShimPath, ["--version", "--json"], {
				encoding: "utf-8",
				env: { ...process.env, PATH: process.env.PATH },
				timeout: 5_000,
			}).trim();

			// The fake CLI entry prints SHIM_TEST_OK:<args>
			expect(output).toContain("SHIM_TEST_OK:");
			// Verify args were forwarded
			expect(output).toContain("--version");
			expect(output).toContain("--json");
		});

		it("shim fails gracefully when CLI entry is missing", () => {
			if (process.platform === "win32") {
				return;
			}

			// Create a second shim pointing to a nonexistent Resources dir
			const emptyResourcesDir = path.join(tmpdir(), `kanban-shim-empty-${Date.now()}`);
			const emptyBinDir = path.join(emptyResourcesDir, "bin");
			mkdirSync(emptyBinDir, { recursive: true });

			const realShimContent = readFileSync(
				path.join(BUILD_BIN_DIR, "kanban"),
				"utf-8",
			);
			const emptyShim = path.join(emptyBinDir, "kanban");
			writeFileSync(emptyShim, realShimContent, { mode: 0o755 });

			try {
				execFileSync(emptyShim, [], {
					encoding: "utf-8",
					timeout: 5_000,
				});
				// Should not reach here
				expect.unreachable("Shim should have exited with error");
			} catch (error: unknown) {
				const err = error as { stderr?: string; status?: number };
				expect(err.status).not.toBe(0);
				expect(err.stderr).toContain("Kanban CLI not found");
			} finally {
				rmSync(emptyResourcesDir, { recursive: true, force: true });
			}
		});
	});
});
