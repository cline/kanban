import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
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
	providerOverrides: [],
};

// ── API key encryption ────────────────────────────────────────────────────
// Admin-provided API keys are encrypted at rest in remote-config.json using
// AES-256-GCM with a machine-derived key (same derivation as remote-auth.ts).
// This prevents plaintext keys from appearing in backup files or logs.

const AES_KEY_BYTES = 32;
const AES_IV_BYTES = 12;

function deriveConfigEncryptionKey(): Buffer {
	const machineId = hostname();
	const salt = Buffer.from("kanban-provider-keys-v1");
	return scryptSync(machineId, salt, AES_KEY_BYTES) as Buffer;
}

export function encryptApiKey(plaintext: string): string {
	const key = deriveConfigEncryptionKey();
	const iv = randomBytes(AES_IV_BYTES);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptApiKey(stored: string): string {
	const parts = stored.split(":");
	if (parts.length !== 3) throw new Error("Invalid encrypted API key format.");
	const [ivHex, tagHex, ciphertextHex] = parts as [string, string, string];
	const key = deriveConfigEncryptionKey();
	const iv = Buffer.from(ivHex, "hex");
	const tag = Buffer.from(tagHex, "hex");
	const ciphertext = Buffer.from(ciphertextHex, "hex");
	const decipher = createDecipheriv("aes-256-gcm", key, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

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
