import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { lockedFileSystem } from "../fs/locked-file-system";
import type { RemoteConfig } from "./types";

// Mirrors the path conventions in src/state/workspace-state.ts:
//   join(homedir(), ".cline", "kanban")
const RUNTIME_HOME_PARENT_DIR = ".cline";
const RUNTIME_HOME_DIR = "kanban";
const REMOTE_CONFIG_FILENAME = "remote-config.json";

export function getRemoteConfigPath(): string {
	return join(homedir(), RUNTIME_HOME_PARENT_DIR, RUNTIME_HOME_DIR, REMOTE_CONFIG_FILENAME);
}

export function getRemoteDbPath(): string {
	return join(homedir(), RUNTIME_HOME_PARENT_DIR, RUNTIME_HOME_DIR, "remote.db");
}

export const DEFAULT_REMOTE_CONFIG: RemoteConfig = {
	authMode: "workos",
	password: "",
	allowedEmails: [],
	allowedEmailDomains: [],
	localUsers: [],
	publicBaseUrl: "",
};

function isEnoent(err: unknown): boolean {
	return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "ENOENT";
}

// Loads RemoteConfig from disk. Returns defaults if the file does not exist.
// Merges defaults with loaded values so that new fields added in future
// versions automatically fall back to their defaults on older installs.
export async function loadRemoteConfig(): Promise<RemoteConfig> {
	try {
		const raw = await readFile(getRemoteConfigPath(), "utf-8");
		const parsed = JSON.parse(raw) as Partial<RemoteConfig>;
		return { ...DEFAULT_REMOTE_CONFIG, ...parsed };
	} catch (err) {
		if (isEnoent(err)) {
			return { ...DEFAULT_REMOTE_CONFIG };
		}
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Could not read remote config at ${getRemoteConfigPath()}. ${message}`);
	}
}

// Atomically writes RemoteConfig to disk using proper-lockfile + temp-file rename.
// Uses the same lockedFileSystem utility as workspace state writes.
export async function saveRemoteConfig(config: RemoteConfig): Promise<void> {
	await lockedFileSystem.writeJsonFileAtomic(getRemoteConfigPath(), config);
}
