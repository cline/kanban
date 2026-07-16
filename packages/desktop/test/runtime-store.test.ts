import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	cleanupPartials,
	clearPointer,
	cliEntryFor,
	isBadVersion,
	markBadVersion,
	partialDir,
	readPointer,
	removeVersionDir,
	resolvePointerCliEntry,
	versionDir,
	versionFromCliEntry,
	writePointer,
} from "../src/runtime-store.js";

let userData: string;

beforeEach(() => {
	userData = mkdtempSync(path.join(tmpdir(), "runtime-store-"));
});

afterEach(() => {
	rmSync(userData, { recursive: true, force: true });
});

const pointerPathFor = (root: string): string =>
	path.join(root, "runtime-store", "current.json");

/** Lay out `versions/<v>/dist/cli.js` so a pointer to it is valid. */
function stageVersion(root: string, version: string): string {
	const cliEntry = cliEntryFor(root, version);
	mkdirSync(path.dirname(cliEntry), { recursive: true });
	writeFileSync(cliEntry, "// runtime");
	return cliEntry;
}

describe("runtime-store: pointer", () => {
	it("returns null when missing or corrupt", () => {
		expect(readPointer(userData)).toBeNull();
		mkdirSync(path.dirname(pointerPathFor(userData)), { recursive: true });
		writeFileSync(pointerPathFor(userData), "{not-json");
		expect(readPointer(userData)).toBeNull();
	});

	it("round-trips atomically (tmp + rename, no leftover *.tmp)", () => {
		const cliEntry = stageVersion(userData, "0.1.66");
		writePointer(userData, { version: "0.1.66", cliEntry });

		const dir = path.dirname(pointerPathFor(userData));
		expect(readdirSync(dir).some((n) => n.endsWith(".tmp"))).toBe(false);
		expect(readPointer(userData)).toEqual({
			version: "0.1.66",
			cliEntry,
		});
	});

	it("rejects garbage on read (semver-invalid version, missing cliEntry)", () => {
		const writeRaw = (body: unknown): void => {
			mkdirSync(path.dirname(pointerPathFor(userData)), { recursive: true });
			writeFileSync(pointerPathFor(userData), JSON.stringify(body));
		};

		writeRaw({ version: "abc", cliEntry: "/x" });
		expect(readPointer(userData)).toBeNull();

		writeRaw({ version: "1.0.0" });
		expect(readPointer(userData)).toBeNull();

		writeRaw({ version: "1.0.0", cliEntry: "" });
		expect(readPointer(userData)).toBeNull();
	});

	it("writePointer rejects a non-semver version", () => {
		expect(() =>
			writePointer(userData, { version: "abc", cliEntry: "/x" }),
		).toThrow(/invalid semver/);
	});

	it("readPointer rejects a non-canonical cliEntry", () => {
		// `cliEntry` is forwarded to the shim as KANBAN_CLI_OVERRIDE.
		// A non-canonical path would let a tampered current.json execute
		// arbitrary on-disk JS, so the pointer must be rejected.
		mkdirSync(path.dirname(pointerPathFor(userData)), { recursive: true });
		writeFileSync(
			pointerPathFor(userData),
			JSON.stringify({ version: "1.0.0", cliEntry: "/elsewhere/cli.js" }),
		);
		expect(readPointer(userData)).toBeNull();
	});

	it("readPointer rejects a relative cliEntry even if it would resolve to the canonical path", () => {
		// Pointer validity must not depend on `process.cwd()` at the
		// moment of read — a relative form is always a packaging /
		// hand-edit bug, not a legitimate state.
		const canonical = cliEntryFor(userData, "1.0.0");
		mkdirSync(path.dirname(pointerPathFor(userData)), { recursive: true });
		const relative = path.relative(process.cwd(), canonical);
		writeFileSync(
			pointerPathFor(userData),
			JSON.stringify({ version: "1.0.0", cliEntry: relative }),
		);
		expect(readPointer(userData)).toBeNull();
	});

	it("writePointer rejects a non-canonical cliEntry", () => {
		expect(() =>
			writePointer(userData, {
				version: "1.0.0",
				cliEntry: "/elsewhere/cli.js",
			}),
		).toThrow(/cliEntry for 1\.0\.0 must be/);
	});

	it("writePointer rejects a relative cliEntry (symmetric with readPointer)", () => {
		// Even if the relative form would resolve to the canonical path
		// from the current cwd, accepting it would let pointer validity
		// depend on `process.cwd()` at write time. The on-disk contract
		// is "absolute canonical path" at both boundaries.
		const canonical = cliEntryFor(userData, "1.0.0");
		const relative = path.relative(process.cwd(), canonical);
		expect(() =>
			writePointer(userData, { version: "1.0.0", cliEntry: relative }),
		).toThrow(/cliEntry for 1\.0\.0 must be/);
	});

	it("clearPointer is a no-op when missing and removes when present", () => {
		expect(() => clearPointer(userData)).not.toThrow();
		const cliEntry = stageVersion(userData, "0.1.0");
		writePointer(userData, { version: "0.1.0", cliEntry });
		clearPointer(userData);
		expect(readPointer(userData)).toBeNull();
	});
});

describe("runtime-store: versionFromCliEntry", () => {
	it("extracts the version from a canonical cliEntry", () => {
		const cli = cliEntryFor(userData, "1.2.3");
		expect(versionFromCliEntry(userData, cli)).toBe("1.2.3");
	});

	it("returns null for a relative cliEntry", () => {
		expect(versionFromCliEntry(userData, "versions/1.2.3/dist/cli.js")).toBeNull();
	});

	it("returns null when the path's <v> segment isn't valid semver", () => {
		const bogus = path.join(userData, "runtime-store", "versions", "abc", "dist", "cli.js");
		expect(versionFromCliEntry(userData, bogus)).toBeNull();
	});

	it("returns null when the path-shape doesn't match `versions/<v>/dist/cli.js`", () => {
		// Right `<v>` segment in the right *position* but wrong root or
		// wrong leaf must not yield a version — otherwise the rollback
		// path could mark a real-but-unrelated version bad and remove
		// its on-disk dir, just because some stray path happened to have
		// `<semver>/dist/cli.js` somewhere in it.

		// Wrong leaf filename.
		const wrongLeaf = path.join(
			userData,
			"runtime-store",
			"versions",
			"1.2.3",
			"dist",
			"not-cli.js",
		);
		expect(versionFromCliEntry(userData, wrongLeaf)).toBeNull();

		// Right shape under the wrong root (different userData).
		const wrongRoot = path.join(
			"/elsewhere",
			"runtime-store",
			"versions",
			"1.2.3",
			"dist",
			"cli.js",
		);
		expect(versionFromCliEntry(userData, wrongRoot)).toBeNull();

		// `<v>` in the right *segment* position but the parent isn't `dist`.
		const wrongParent = path.join(
			userData,
			"runtime-store",
			"versions",
			"1.2.3",
			"build",
			"cli.js",
		);
		expect(versionFromCliEntry(userData, wrongParent)).toBeNull();
	});
});

describe("runtime-store: resolvePointerCliEntry", () => {
	it("returns null when no pointer exists", () => {
		expect(resolvePointerCliEntry(userData)).toBeNull();
	});

	it("returns the cliEntry when it exists on disk", () => {
		const cliEntry = stageVersion(userData, "0.5.0");
		writePointer(userData, { version: "0.5.0", cliEntry });
		expect(resolvePointerCliEntry(userData)).toBe(cliEntry);
	});

	it("returns null when pointer exists but cliEntry is missing on disk", () => {
		// Caller (`createRuntimeAutoUpdate.loadOverride`) uses this signal
		// to drop the pointer and unfreeze the background updater.
		const cliEntry = stageVersion(userData, "0.6.0");
		writePointer(userData, { version: "0.6.0", cliEntry });
		rmSync(path.dirname(cliEntry), { recursive: true });
		expect(resolvePointerCliEntry(userData)).toBeNull();
	});
});

describe("runtime-store: bad-versions", () => {
	it("isBadVersion is false for everything when the file is missing", () => {
		expect(isBadVersion(userData, "1.0.0")).toBe(false);
	});

	it("markBadVersion persists, deduplicates, and sorts by semver", () => {
		markBadVersion(userData, "1.10.0");
		markBadVersion(userData, "1.2.0");
		markBadVersion(userData, "1.10.0");
		expect(isBadVersion(userData, "1.2.0")).toBe(true);
		expect(isBadVersion(userData, "1.10.0")).toBe(true);
		expect(isBadVersion(userData, "1.5.0")).toBe(false);

		const raw = readFileSync(
			path.join(userData, "runtime-store", "bad-versions.json"),
			"utf8",
		);
		expect(JSON.parse(raw)).toEqual(["1.2.0", "1.10.0"]);
	});

	it("rejects non-semver on write, ignores corrupt file on read", () => {
		expect(() => markBadVersion(userData, "junk")).toThrow(/invalid semver/);

		mkdirSync(path.join(userData, "runtime-store"), { recursive: true });
		writeFileSync(
			path.join(userData, "runtime-store", "bad-versions.json"),
			"{not-json",
		);
		expect(isBadVersion(userData, "1.0.0")).toBe(false);
	});
});

describe("runtime-store: cleanup", () => {
	it("cleanupPartials removes only `*.partial` directories", () => {
		mkdirSync(versionDir(userData, "0.1.0"), { recursive: true });
		mkdirSync(partialDir(userData, "0.5.0"), { recursive: true });
		cleanupPartials(userData);
		expect(existsSync(versionDir(userData, "0.1.0"))).toBe(true);
		expect(existsSync(partialDir(userData, "0.5.0"))).toBe(false);
	});

	it("cleanupPartials is a no-op when versions root does not exist", () => {
		expect(() => cleanupPartials(userData)).not.toThrow();
	});

	it("removeVersionDir clears a finalized dir and is safe with garbage input", () => {
		stageVersion(userData, "1.0.0");
		removeVersionDir(userData, "1.0.0");
		expect(existsSync(versionDir(userData, "1.0.0"))).toBe(false);
		expect(() => removeVersionDir(userData, "../../etc")).not.toThrow();
	});

	it("versionDir / partialDir reject non-semver inputs", () => {
		expect(() => versionDir(userData, "../../etc")).toThrow(/invalid semver/);
		expect(() => partialDir(userData, "abc")).toThrow(/invalid semver/);
	});
});
