/**
 * On-disk layout for the staged Kanban runtime under `${userData}/runtime-store/`:
 *
 *   current.json          — pointer { version, cliEntry }
 *   bad-versions.json     — versions to skip after a startup failure
 *   versions/<v>/         — finalized runtime
 *   versions/<v>.partial/ — in-flight extract; never read at boot
 *
 * The bundled runtime in `app.asar.unpacked/cli/` is the fallback —
 * if the pointer is missing or its spawn fails, we drop the pointer
 * and the shim launches bundled.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

import semver from "semver";

export interface RuntimePointer {
	version: string;
	/** Absolute path to `versions/<version>/dist/cli.js`. */
	cliEntry: string;
}

const POINTER_FILE = "current.json";
const BAD_VERSIONS_FILE = "bad-versions.json";

const root = (userData: string): string => path.join(userData, "runtime-store");
const pointerPath = (userData: string): string =>
	path.join(root(userData), POINTER_FILE);
const badVersionsPath = (userData: string): string =>
	path.join(root(userData), BAD_VERSIONS_FILE);

const isSemver = (v: unknown): v is string =>
	typeof v === "string" && semver.valid(v) !== null;

export function versionDir(userData: string, version: string): string {
	if (!isSemver(version)) {
		throw new Error(`runtime-store: invalid semver: ${version}`);
	}
	return path.join(root(userData), "versions", version);
}

export function partialDir(userData: string, version: string): string {
	return `${versionDir(userData, version)}.partial`;
}

export function cliEntryFor(userData: string, version: string): string {
	return path.join(versionDir(userData, version), "dist", "cli.js");
}

/**
 * Inverse of `cliEntryFor`. Walks back from a canonical cliEntry to
 * its `<v>` segment. Returns `null` unless the full path fits the
 * `<userData>/runtime-store/versions/<v>/dist/cli.js` shape AND
 * `<v>` is valid semver — checked by re-deriving via `cliEntryFor`
 * and string-comparing. Validating the full shape (not just the
 * `<v>` segment) means a stray path like `/tmp/1.2.3/dist/not-cli.js`
 * or `/elsewhere/1.2.3/dist/cli.js` doesn't accidentally produce
 * `"1.2.3"`, which would let the rollback path mark a real-but-
 * unrelated version bad and remove its on-disk dir.
 *
 * Callers that capture the override path at spawn time use this to
 * roll back the version that *actually* ran — without re-reading the
 * pointer (which a concurrent background stage may have replaced).
 */
export function versionFromCliEntry(
	userData: string,
	cliEntry: string,
): string | null {
	if (!path.isAbsolute(cliEntry)) return null;
	const v = path.basename(path.dirname(path.dirname(cliEntry)));
	if (!isSemver(v)) return null;
	return cliEntry === cliEntryFor(userData, v) ? v : null;
}

function atomicWrite(target: string, body: string): void {
	mkdirSync(path.dirname(target), { recursive: true });
	const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(tmp, body);
	renameSync(tmp, target);
}

/**
 * Pointer's `cliEntry` must be the canonical path for the pointer's
 * version. We pass `cliEntry` to the shim as `KANBAN_CLI_OVERRIDE`,
 * so a non-canonical or out-of-tree path would let a tampered
 * `current.json` execute arbitrary on-disk JS. Returns the canonical
 * absolute path so callers don't have to re-resolve.
 */
export function readPointer(userData: string): RuntimePointer | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(pointerPath(userData), "utf8"));
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const { version, cliEntry } = parsed as Record<string, unknown>;
	if (!isSemver(version)) return null;
	if (typeof cliEntry !== "string" || cliEntry.length === 0) return null;
	// Require absolute paths only — the on-disk contract is "absolute
	// canonical path under runtime-store/". Accepting a relative form
	// here would make pointer validity depend on `process.cwd()` at the
	// moment of read, which is cwd-dependent footgun for no benefit.
	if (!path.isAbsolute(cliEntry)) return null;
	if (cliEntry !== cliEntryFor(userData, version)) return null;
	return { version, cliEntry };
}

/**
 * Whether a `current.json` exists on disk regardless of whether it
 * parses/validates. Used by callers that need to clean up an invalid
 * pointer file (e.g. tampered or hand-edited) — `readPointer()` returning
 * null doesn't tell them apart from "no pointer at all".
 */
export function pointerFileExists(userData: string): boolean {
	try {
		return statSync(pointerPath(userData)).isFile();
	} catch {
		return false;
	}
}

export function writePointer(userData: string, p: RuntimePointer): void {
	if (!isSemver(p.version)) {
		throw new Error(`runtime-store: invalid semver: ${p.version}`);
	}
	// Symmetric with `readPointer`'s absolute-path contract — a relative
	// `cliEntry` that happens to resolve to the canonical path from the
	// caller's `process.cwd()` would round-trip through writer + reader
	// today, but pointer validity must not depend on cwd at *either*
	// boundary. Require absolute input here so the on-disk contract
	// ("`cliEntry` is the canonical absolute path") is enforced uniformly.
	const canonical = cliEntryFor(userData, p.version);
	if (!path.isAbsolute(p.cliEntry) || p.cliEntry !== canonical) {
		throw new Error(
			`runtime-store: cliEntry for ${p.version} must be ${canonical}, got ${p.cliEntry}`,
		);
	}
	atomicWrite(
		pointerPath(userData),
		`${JSON.stringify({ version: p.version, cliEntry: canonical })}\n`,
	);
}

export function clearPointer(userData: string): void {
	rmSync(pointerPath(userData), { force: true });
}

/** Pointer's cliEntry iff the file exists on disk. */
export function resolvePointerCliEntry(userData: string): string | null {
	const p = readPointer(userData);
	if (!p) return null;
	try {
		return statSync(p.cliEntry).isFile() ? p.cliEntry : null;
	} catch {
		return null;
	}
}

/** Sweep `<v>.partial/` left over from interrupted extracts. Best-effort. */
export function cleanupPartials(userData: string): void {
	const versions = path.join(root(userData), "versions");
	if (!existsSync(versions)) return;
	for (const e of readdirSync(versions, { withFileTypes: true })) {
		if (e.isDirectory() && e.name.endsWith(".partial")) {
			rmSync(path.join(versions, e.name), { recursive: true, force: true });
		}
	}
}

export function removeVersionDir(userData: string, version: string): void {
	if (!isSemver(version)) return;
	rmSync(versionDir(userData, version), { recursive: true, force: true });
}

// -----------------------------------------------------------------
// Bad-version markers — stop the updater from re-staging a version
// that already failed startup. Entries are never pruned; the registry
// only publishes monotonically increasing versions and we only ever
// check `isBadVersion(latest)`, so old entries are dead weight (a few
// bytes) but never re-examined. If the file ever needs trimming, do
// it lazily here against an `effectiveCurrentVersion` argument.
// -----------------------------------------------------------------

function readBadVersions(userData: string): string[] {
	try {
		const parsed = JSON.parse(readFileSync(badVersionsPath(userData), "utf8"));
		return Array.isArray(parsed) ? parsed.filter(isSemver) : [];
	} catch {
		return [];
	}
}

export function isBadVersion(userData: string, version: string): boolean {
	return isSemver(version) && readBadVersions(userData).includes(version);
}

export function markBadVersion(userData: string, version: string): void {
	if (!isSemver(version)) {
		throw new Error(`runtime-store: invalid semver: ${version}`);
	}
	const set = new Set(readBadVersions(userData));
	set.add(version);
	atomicWrite(
		badVersionsPath(userData),
		`${JSON.stringify([...set].sort(semver.compare))}\n`,
	);
}
