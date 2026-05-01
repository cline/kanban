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

	it("macOS/Linux shim references the bundled CLI entry point", () => {
		const shimPath = path.join(BUILD_BIN_DIR, "kanban");
		const content = readFileSync(shimPath, "utf-8");
		// Must reference the extraResources-copied CLI entry, not a bare "kanban" binary
		expect(content).toContain("cli/cli.js");
		// Must use node to run it
		expect(content).toContain("exec node");
	});

	it("Windows shim references the bundled CLI entry point", () => {
		const shimPath = path.join(BUILD_BIN_DIR, "kanban.cmd");
		const content = readFileSync(shimPath, "utf-8");
		expect(content).toContain("cli\\cli.js");
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
			// Mirrors the packaged layout: electron-builder packs ../../dist/
			// into app.asar at path cli/, then asarUnpack extracts it to
			// Resources/app.asar.unpacked/cli/ so node can execute it and so
			// ESM resolution walks up to app.asar.unpacked/node_modules/ for
			// node-pty. See electron-builder.yml.
			const cliDir = path.join(fakeResourcesDir, "app.asar.unpacked", "cli");
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

	// Shell-shim edge cases (bash-only). Regression coverage for exit-code
	// propagation, paths with spaces, and arg forwarding with special chars.
	describe("shim shell semantics (macOS/Linux)", () => {
		/**
		 * Build an isolated fake Resources/ layout with a custom CLI body
		 * and return the shim path. Each caller is responsible for cleanup.
		 */
		function buildFakeLayout(opts: {
			cliBody: string;
			resourcesDirName?: string;
		}): { resourcesDir: string; shimPath: string } {
			const name = opts.resourcesDirName ?? `kanban-shim-edge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
			const resourcesDir = path.join(tmpdir(), name);
			const binDir = path.join(resourcesDir, "bin");
			const cliDir = path.join(resourcesDir, "app.asar.unpacked", "cli");
			mkdirSync(binDir, { recursive: true });
			mkdirSync(cliDir, { recursive: true });

			writeFileSync(path.join(cliDir, "cli.js"), opts.cliBody, "utf-8");

			const realShimContent = readFileSync(
				path.join(BUILD_BIN_DIR, "kanban"),
				"utf-8",
			);
			const shimPath = path.join(binDir, "kanban");
			writeFileSync(shimPath, realShimContent, { mode: 0o755 });

			return { resourcesDir, shimPath };
		}

		it("propagates the CLI's non-zero exit code to the caller", () => {
			if (process.platform === "win32") return;

			const { resourcesDir, shimPath } = buildFakeLayout({
				cliBody: `process.exit(42);`,
			});
			try {
				execFileSync(shimPath, [], { encoding: "utf-8", timeout: 5_000 });
				expect.unreachable("Shim should have exited with the CLI's status");
			} catch (error: unknown) {
				// The `exec` builtin replaces the shell process with node, so
				// node's exit status becomes the shim's exit status directly.
				expect((error as { status?: number }).status).toBe(42);
			} finally {
				rmSync(resourcesDir, { recursive: true, force: true });
			}
		});

		it("works when the install path contains spaces", () => {
			if (process.platform === "win32") return;

			const { resourcesDir, shimPath } = buildFakeLayout({
				// Echo the script dir so we can sanity-check it really did
				// contain a space — not just accidentally run against the
				// wrong Resources tree.
				cliBody: `console.log("OK:" + __filename);`,
				resourcesDirName: `kanban shim with spaces ${Date.now()}`,
			});
			try {
				const output = execFileSync(shimPath, [], {
					encoding: "utf-8",
					timeout: 5_000,
				}).trim();
				expect(output.startsWith("OK:")).toBe(true);
				expect(output).toContain(" "); // resolved CLI path kept the space
				expect(output).toContain(resourcesDir);
			} finally {
				rmSync(resourcesDir, { recursive: true, force: true });
			}
		});

		it("prefers the bundled Electron binary over system node when present", () => {
			// Regression test for the launch-failure mode where users
			// without a system `node` on PATH (the common case for non-
			// developers on macOS / GUI-launched Linux apps) couldn't run
			// `kanban` from a packaged build because `exec node` ENOENT'd.
			// The shim now prefers `ELECTRON_RUN_AS_NODE=1` against the
			// bundled Electron binary, so this only requires the user to
			// have launched the .app at least once. We verify the shim
			// actually invokes the binary rather than falling through to
			// system node.
			if (process.platform === "win32") return;

			const resourcesDirName = `kanban-shim-electron-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
			const appRoot = path.join(tmpdir(), resourcesDirName);
			const resourcesDir = path.join(appRoot, "Resources");
			const binDir = path.join(resourcesDir, "bin");
			const cliDir = path.join(resourcesDir, "app.asar.unpacked", "cli");
			// macOS layout: APP_ROOT/MacOS/Kanban is the Electron exec.
			// On Linux the shim looks for APP_ROOT/kanban — mirror both so
			// this test runs on either OS without a platform branch.
			const macOsDir = path.join(appRoot, "MacOS");
			mkdirSync(binDir, { recursive: true });
			mkdirSync(cliDir, { recursive: true });
			mkdirSync(macOsDir, { recursive: true });

			writeFileSync(
				path.join(cliDir, "cli.js"),
				`process.stdout.write("FROM_ELECTRON:" + (process.env.ELECTRON_RUN_AS_NODE ?? "<unset>") + ":" + JSON.stringify(process.argv.slice(2)));`,
				"utf-8",
			);

			// Stub Electron binary: a shell script that exec's real node
			// against the script path, but only when ELECTRON_RUN_AS_NODE=1
			// is set (matching real Electron's behavior). This lets us
			// verify the shim set the env var AND chose this binary over
			// system node.
			const electronStub = `#!/bin/bash
if [ "$ELECTRON_RUN_AS_NODE" != "1" ]; then
  echo "ELECTRON_RUN_AS_NODE not set" >&2
  exit 99
fi
exec node "$@"
`;
			const electronBinMac = path.join(macOsDir, "Kanban");
			const electronBinLinux = path.join(appRoot, "kanban");
			writeFileSync(electronBinMac, electronStub, { mode: 0o755 });
			writeFileSync(electronBinLinux, electronStub, { mode: 0o755 });

			const realShimContent = readFileSync(
				path.join(BUILD_BIN_DIR, "kanban"),
				"utf-8",
			);
			const shimPath = path.join(binDir, "kanban");
			writeFileSync(shimPath, realShimContent, { mode: 0o755 });

			try {
				const output = execFileSync(shimPath, ["--version"], {
					encoding: "utf-8",
					timeout: 5_000,
				}).trim();
				// Marker proves: (1) the bundled Electron stub ran, not
				// system node directly; (2) ELECTRON_RUN_AS_NODE was "1"
				// in the child env; (3) args were forwarded.
				expect(output).toBe(`FROM_ELECTRON:1:["--version"]`);
			} finally {
				rmSync(appRoot, { recursive: true, force: true });
			}
		});

		it("forwards args containing spaces, quotes, and flag-value pairs intact", () => {

			if (process.platform === "win32") return;

			const { resourcesDir, shimPath } = buildFakeLayout({
				cliBody: `process.stdout.write(JSON.stringify(process.argv.slice(2)));`,
			});
			try {
				const args = [
					"first",
					"arg with spaces",
					"--flag=value with spaces",
					"--",
					"quoted 'single' and \"double\"",
				];
				const output = execFileSync(shimPath, args, {
					encoding: "utf-8",
					timeout: 5_000,
				});
				// Round-trip via JSON: the CLI's argv[2..] must match what we
				// passed, byte-for-byte.
				expect(JSON.parse(output)).toEqual(args);
			} finally {
				rmSync(resourcesDir, { recursive: true, force: true });
			}
		});
	});
});
