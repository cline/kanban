/**
 * Stage the latest published `kanban` runtime under userData so the
 * installed shell can run a newer runtime than it was packaged with —
 * without requiring a shell reinstall.
 *
 * Failures before the pointer write leave the existing pointer
 * untouched. The bundled runtime under `app.asar.unpacked/cli/`
 * remains the fallback.
 */

import { existsSync } from "node:fs";
import { cp, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import pacote from "pacote";
import semver from "semver";

import {
	cleanupPartials,
	cliEntryFor,
	isBadVersion,
	partialDir,
	resolvePointerCliEntry,
	versionDir,
	versionFromCliEntry,
	writePointer,
} from "./runtime-store.js";

const PACKAGE = "kanban";

export interface CheckOptions {
	userData: string;
	/** Version we'd launch right now (pointer or bundled). */
	currentVersion: string;
	/** `app.asar.unpacked/node_modules/` — source for bundled `node-pty`. */
	nativeDepsSource: string;
}

export type StageOutcome =
	| { kind: "staged"; version: string }
	| { kind: "up-to-date" }
	| { kind: "already-staged" }
	| { kind: "bad-version"; version: string };

export async function checkAndStageLatestRuntime(
	opts: CheckOptions,
): Promise<StageOutcome> {
	const manifest = await pacote.manifest(`${PACKAGE}@latest`);
	const latest = manifest.version;
	if (!semver.valid(latest)) {
		throw new Error(`runtime-update: registry returned non-semver: ${latest}`);
	}

	// `currentVersion` may come from a stale/invalid pointer — defend
	// against semver.gt throwing on garbage input.
	if (
		semver.valid(opts.currentVersion) &&
		!semver.gt(latest, opts.currentVersion)
	) {
		return { kind: "up-to-date" };
	}
	if (isBadVersion(opts.userData, latest)) {
		return { kind: "bad-version", version: latest };
	}
	// `already-staged` requires both a pointer at `latest` AND its
	// `cliEntry` actually present on disk. Without the file-exists
	// check this gate would silently lie when the version dir was
	// wiped (corrupt userData, manual cleanup, partial uninstall),
	// leaving the user's runtime in a state where loadOverride keeps
	// returning null *and* the updater keeps short-circuiting on
	// "already-staged" forever.
	const stagedCli = resolvePointerCliEntry(opts.userData);
	if (stagedCli && versionFromCliEntry(opts.userData, stagedCli) === latest) {
		return { kind: "already-staged" };
	}

	cleanupPartials(opts.userData);
	const stage = partialDir(opts.userData, latest);
	await rm(stage, { recursive: true, force: true });
	await mkdir(path.dirname(stage), { recursive: true });
	await pacote.extract(`${PACKAGE}@${latest}`, stage);

	// `node-pty` is the sole external in `kanban`'s esbuild build
	// (see scripts/build.mjs). pacote.extract doesn't install deps,
	// so reuse the desktop's bundled prebuilt — already ABI-matched
	// to this Electron, no `npm` required at runtime.
	const ptySrc = path.join(opts.nativeDepsSource, "node-pty");
	if (!existsSync(ptySrc)) {
		throw new Error(`runtime-update: bundled node-pty missing at ${ptySrc}`);
	}
	await cp(ptySrc, path.join(stage, "node_modules", "node-pty"), {
		recursive: true,
		dereference: true,
	});

	if (!existsSync(path.join(stage, "dist", "cli.js"))) {
		throw new Error("runtime-update: extracted package missing dist/cli.js");
	}

	const finalDir = versionDir(opts.userData, latest);
	await rm(finalDir, { recursive: true, force: true });
	await rename(stage, finalDir);
	writePointer(opts.userData, {
		version: latest,
		cliEntry: cliEntryFor(opts.userData, latest),
	});
	return { kind: "staged", version: latest };
}
