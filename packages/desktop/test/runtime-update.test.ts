/**
 * Unit tests for `runtime-update.checkAndStageLatestRuntime`. pacote is
 * mocked at the module boundary so these tests don't hit the registry.
 */

import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	cliEntryFor,
	markBadVersion,
	readPointer,
	versionDir,
	writePointer,
} from "../src/runtime-store.js";
import { checkAndStageLatestRuntime } from "../src/runtime-update.js";

const manifestMock = vi.fn();
const extractMock = vi.fn();

vi.mock("pacote", () => ({
	default: {
		manifest: (...args: unknown[]) => manifestMock(...args),
		extract: (...args: unknown[]) => extractMock(...args),
	},
}));

let userData: string;
let nativeDepsSource: string;

beforeEach(() => {
	userData = mkdtempSync(path.join(tmpdir(), "runtime-update-"));
	nativeDepsSource = mkdtempSync(path.join(tmpdir(), "runtime-update-deps-"));
	// Pretend node-pty is bundled — the updater copies it into each
	// staged version. A bare directory is enough for `cp -r`.
	mkdirSync(path.join(nativeDepsSource, "node-pty"), { recursive: true });
	writeFileSync(
		path.join(nativeDepsSource, "node-pty", "package.json"),
		JSON.stringify({ name: "node-pty", version: "1.0.0" }),
	);

	manifestMock.mockReset();
	extractMock.mockReset();

	// Default extract: lay out a `dist/cli.js` so the post-extract
	// sanity check passes. Tests override this for failure modes.
	extractMock.mockImplementation(async (_spec: string, dest: string) => {
		mkdirSync(path.join(dest, "dist"), { recursive: true });
		writeFileSync(path.join(dest, "dist", "cli.js"), "// runtime");
	});
});

afterEach(() => {
	rmSync(userData, { recursive: true, force: true });
	rmSync(nativeDepsSource, { recursive: true, force: true });
});

describe("checkAndStageLatestRuntime: gates", () => {
	it("returns up-to-date when latest <= currentVersion", async () => {
		manifestMock.mockResolvedValueOnce({ version: "0.1.0" });

		const outcome = await checkAndStageLatestRuntime({
			userData,
			currentVersion: "0.1.0",
			nativeDepsSource,
		});

		expect(outcome).toEqual({ kind: "up-to-date" });
		expect(extractMock).not.toHaveBeenCalled();
	});

	it("returns already-staged when pointer.version === latest", async () => {
		const cliEntry = cliEntryFor(userData, "0.5.0");
		mkdirSync(path.dirname(cliEntry), { recursive: true });
		writeFileSync(cliEntry, "// runtime");
		writePointer(userData, { version: "0.5.0", cliEntry });
		manifestMock.mockResolvedValueOnce({ version: "0.5.0" });

		const outcome = await checkAndStageLatestRuntime({
			userData,
			currentVersion: "0.4.0",
			nativeDepsSource,
		});

		expect(outcome).toEqual({ kind: "already-staged" });
		expect(extractMock).not.toHaveBeenCalled();
	});

	it("skips bad versions without extracting", async () => {
		markBadVersion(userData, "1.0.0");
		manifestMock.mockResolvedValueOnce({ version: "1.0.0" });

		const outcome = await checkAndStageLatestRuntime({
			userData,
			currentVersion: "0.5.0",
			nativeDepsSource,
		});

		expect(outcome).toEqual({ kind: "bad-version", version: "1.0.0" });
		expect(extractMock).not.toHaveBeenCalled();
	});

	it("throws on a non-semver registry version", async () => {
		manifestMock.mockResolvedValueOnce({ version: "garbage" });
		await expect(
			checkAndStageLatestRuntime({
				userData,
				currentVersion: "0.1.0",
				nativeDepsSource,
			}),
		).rejects.toThrow(/non-semver/);
	});

	it("treats a non-semver currentVersion as 'unknown' and proceeds", async () => {
		// Defends against a corrupted pointer leaking a non-semver version
		// into the gate; without the guard, semver.gt would throw.
		manifestMock.mockResolvedValueOnce({ version: "1.0.0" });

		const outcome = await checkAndStageLatestRuntime({
			userData,
			currentVersion: "garbage",
			nativeDepsSource,
		});

		expect(outcome.kind).toBe("staged");
	});
});

describe("checkAndStageLatestRuntime: staging", () => {
	it("stages, copies node-pty, and writes the pointer atomically", async () => {
		manifestMock.mockResolvedValueOnce({ version: "1.0.0" });

		const outcome = await checkAndStageLatestRuntime({
			userData,
			currentVersion: "0.5.0",
			nativeDepsSource,
		});

		expect(outcome).toEqual({ kind: "staged", version: "1.0.0" });
		expect(readPointer(userData)).toEqual({
			version: "1.0.0",
			cliEntry: cliEntryFor(userData, "1.0.0"),
		});

		const finalDir = versionDir(userData, "1.0.0");
		expect(
			readdirSync(path.join(finalDir, "node_modules")).includes("node-pty"),
		).toBe(true);
		expect(
			readdirSync(path.dirname(finalDir)).every((n) => !n.endsWith(".partial")),
		).toBe(true);
	});

	it("throws (and leaves pointer untouched) when bundled node-pty is missing", async () => {
		rmSync(path.join(nativeDepsSource, "node-pty"), { recursive: true });
		manifestMock.mockResolvedValueOnce({ version: "1.0.0" });

		await expect(
			checkAndStageLatestRuntime({
				userData,
				currentVersion: "0.5.0",
				nativeDepsSource,
			}),
		).rejects.toThrow(/bundled node-pty missing/);
		expect(readPointer(userData)).toBeNull();
	});

	it("throws when the extracted package has no dist/cli.js", async () => {
		extractMock.mockImplementationOnce(async (_spec: string, dest: string) => {
			mkdirSync(dest, { recursive: true });
		});
		manifestMock.mockResolvedValueOnce({ version: "1.0.0" });

		await expect(
			checkAndStageLatestRuntime({
				userData,
				currentVersion: "0.5.0",
				nativeDepsSource,
			}),
		).rejects.toThrow(/missing dist\/cli\.js/);
		expect(readPointer(userData)).toBeNull();
	});

	it("recovers from a stale `<v>.partial/` left by a prior interrupted run", async () => {
		mkdirSync(`${versionDir(userData, "1.0.0")}.partial`, { recursive: true });
		manifestMock.mockResolvedValueOnce({ version: "1.0.0" });

		const outcome = await checkAndStageLatestRuntime({
			userData,
			currentVersion: "0.5.0",
			nativeDepsSource,
		});

		expect(outcome.kind).toBe("staged");
		expect(readPointer(userData)?.version).toBe("1.0.0");
	});
});
