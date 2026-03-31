// Remote authentication layer.
//
// Responsibilities:
//   - Detect whether a request comes from localhost (no auth needed) or a
//     remote client (auth required).
//   - Manage a SQLite-backed session store with HMAC-signed JWT tokens.
//   - Hash and verify passwords using Node's built-in crypto.scrypt.
//   - Encrypt the signing secret at rest with AES-256-GCM.
//
// Sessions:
//   - Default lifetime: 7 days from issuance.
//   - Persistent sessions: 30-day rolling window; every validated request
//     extends expires_at by 30 days from now.
//   - Sessions are lost when the signing secret is regenerated (i.e. never,
//     unless remote.db is deleted). The secret survives server restarts.

import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	randomBytes,
	scrypt,
	scryptSync,
	timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage } from "node:http";
import { hostname } from "node:os";
import { promisify } from "node:util";

import { loadSqliteDb } from "@clinebot/shared/db";
import { jwtVerify, SignJWT } from "jose";

import { getRemoteDbPath } from "../remote/config-store";
import { createPushManager, type PushManager } from "./push-manager";

const scryptAsync = promisify(scrypt);

// ── Constants ──────────────────────────────────────────────────────────────

const SESSION_COOKIE_NAME = "kanban-remote-session";
const JWT_ALGORITHM = "HS256";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const PERSISTENT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SCRYPT_KEYLEN = 64;
const AES_KEY_BYTES = 32;
const AES_IV_BYTES = 12; // GCM standard

// ── Types ──────────────────────────────────────────────────────────────────

export interface RemoteSession {
	sessionId: string;
	email: string;
	userId: string | null;
	// Stable UUID for this user — from remote_users table.
	userUuid: string;
	// WorkOS displayName or pre-@ email portion.
	displayName: string;
	issuedAt: number;
	expiresAt: number;
	persistent: boolean;
}

export interface RemoteUserRecord {
	uuid: string;
	email: string;
	displayName: string | null;
	createdAt: number;
}

export interface RemoteAuth {
	// Returns true if the request originates from localhost.
	isLocal(req: IncomingMessage): boolean;
	// Creates a new session and returns a Set-Cookie header value.
	// Also upserts a remote_users record for the email.
	createSession(opts: {
		email: string;
		userId: string | null;
		displayName: string | null;
		persistent: boolean;
	}): Promise<{ cookie: string; token: string }>;
	// Validates a cookie header or raw JWT. Returns the session or null.
	validateSession(cookieOrToken: string): Promise<RemoteSession | null>;
	// Extends expires_at for persistent sessions; updates last_seen for all.
	touchSession(sessionId: string): Promise<void>;
	// Revokes a single session.
	revokeSession(sessionId: string): void;
	// Revokes all sessions for a given email address.
	revokeAllSessionsForEmail(email: string): void;
	// Returns all active sessions (for the management UI).
	listSessions(): RemoteSessionRecord[];
	// Looks up or creates a user record, returning the stable UUID.
	getOrCreateUserRecord(email: string, displayName: string | null): RemoteUserRecord;
	// Hashes a plaintext password. Returns "salt:hash" hex string.
	hashPassword(password: string): Promise<string>;
	// Verifies a plaintext password against a stored hash.
	verifyPassword(input: string, storedHash: string): Promise<boolean>;
	// Returns a Set-Cookie header that clears the session cookie.
	clearCookie(): string;
	// VAPID push notification manager — shares the same DB connection.
	pushManager: PushManager;
	// Closes the database connection.
	close(): void;
}

export interface RemoteSessionRecord {
	id: string;
	email: string;
	userId: string | null;
	userUuid: string;
	displayName: string | null;
	issuedAt: number;
	expiresAt: number;
	lastSeen: number;
	persistent: boolean;
}

// ── Localhost detection ────────────────────────────────────────────────────

// Returns true only when BOTH the remote address AND the Host header indicate
// a local connection. This prevents spoofing via a crafted Host header alone.
export function isLocalRequest(req: IncomingMessage): boolean {
	const addr = req.socket.remoteAddress ?? "";
	const isLocalAddr = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
	if (!isLocalAddr) return false;

	// When the Host header is absent (e.g. WebSocket upgrade) we trust the IP.
	const hostHeader = req.headers.host ?? "";
	if (!hostHeader) return true;

	const host = hostHeader.split(":")[0] ?? "";
	return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

// ── AES-256-GCM helpers ───────────────────────────────────────────────────

// Derives a machine-bound AES key from hostname + a fixed application salt.
// This means the encrypted secret in the DB is only decryptable on the same
// machine, providing an additional layer of protection if the DB file leaks.
function deriveMachineKey(): Buffer {
	const machineId = hostname();
	const salt = Buffer.from("kanban-remote-auth-v1");
	return scryptSync(machineId, salt, AES_KEY_BYTES) as Buffer;
}

function encryptValue(plaintext: string, machineKey: Buffer): string {
	const iv = randomBytes(AES_IV_BYTES);
	const cipher = createCipheriv("aes-256-gcm", machineKey, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	// Format: iv(hex):tag(hex):ciphertext(hex)
	return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptValue(stored: string, machineKey: Buffer): string {
	const parts = stored.split(":");
	if (parts.length !== 3) throw new Error("Invalid encrypted value format.");
	const [ivHex, tagHex, ciphertextHex] = parts as [string, string, string];
	const iv = Buffer.from(ivHex, "hex");
	const tag = Buffer.from(tagHex, "hex");
	const ciphertext = Buffer.from(ciphertextHex, "hex");
	const decipher = createDecipheriv("aes-256-gcm", machineKey, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// ── Database schema ────────────────────────────────────────────────────────

function initSchema(db: Awaited<ReturnType<typeof loadSqliteDb>>): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS remote_users (
			uuid         TEXT    PRIMARY KEY,
			email        TEXT    NOT NULL UNIQUE,
			display_name TEXT,
			created_at   INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_remote_users_email ON remote_users (email);

		CREATE TABLE IF NOT EXISTS remote_sessions (
			id           TEXT    PRIMARY KEY,
			email        TEXT    NOT NULL,
			user_id      TEXT,
			user_uuid    TEXT    NOT NULL,
			display_name TEXT,
			issued_at    INTEGER NOT NULL,
			expires_at   INTEGER NOT NULL,
			last_seen    INTEGER NOT NULL,
			persistent   INTEGER NOT NULL DEFAULT 0
		);
		CREATE INDEX IF NOT EXISTS idx_remote_sessions_email ON remote_sessions (email);
		CREATE INDEX IF NOT EXISTS idx_remote_sessions_expires ON remote_sessions (expires_at);

		CREATE TABLE IF NOT EXISTS remote_secrets (
			key         TEXT    PRIMARY KEY,
			value_enc   TEXT    NOT NULL,
			created_at  INTEGER NOT NULL
		);
	`);
}

// Derives a display name from an email address when none is provided.
// Returns the portion before the @ sign, capitalised.
function displayNameFromEmail(email: string): string {
	const local = email.split("@")[0] ?? email;
	return local.charAt(0).toUpperCase() + local.slice(1);
}

// ── Factory ────────────────────────────────────────────────────────────────

export async function createRemoteAuth(): Promise<RemoteAuth> {
	const db = await loadSqliteDb(getRemoteDbPath());
	initSchema(db);

	const machineKey = deriveMachineKey();

	// Create the push manager, reusing the same DB connection and machine key.
	const pushManager = await createPushManager(
		db,
		(plaintext) => encryptValue(plaintext, machineKey),
		(stored) => decryptValue(stored, machineKey),
	);

	// Load or generate the HMAC signing secret, encrypted at rest.
	let signingSecret: Uint8Array;
	const secretRow = db.prepare("SELECT value_enc FROM remote_secrets WHERE key = 'signing_secret'").get() as unknown as
		| { value_enc: string }
		| undefined;

	if (secretRow) {
		const hex = decryptValue(secretRow.value_enc, machineKey);
		signingSecret = Buffer.from(hex, "hex");
	} else {
		const raw = randomBytes(32);
		signingSecret = raw;
		const encrypted = encryptValue(raw.toString("hex"), machineKey);
		db.prepare("INSERT INTO remote_secrets (key, value_enc, created_at) VALUES (?, ?, ?)").run(
			"signing_secret",
			encrypted,
			Date.now(),
		);
	}

	// Purge expired sessions on startup.
	db.prepare("DELETE FROM remote_sessions WHERE expires_at < ?").run(Date.now());

	// ── Session helpers ──────────────────────────────────────────────────

	function generateSessionId(): string {
		return randomBytes(16).toString("hex");
	}

	function cookieHeader(token: string, maxAgeSeconds: number): string {
		return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
	}

	function extractTokenFromCookie(cookieHeader: string): string | null {
		const pairs = cookieHeader.split(";").map((s) => s.trim());
		for (const pair of pairs) {
			const eqIdx = pair.indexOf("=");
			if (eqIdx === -1) continue;
			const name = pair.slice(0, eqIdx).trim();
			const value = pair.slice(eqIdx + 1).trim();
			if (name === SESSION_COOKIE_NAME) return value;
		}
		return null;
	}

	// ── User record helpers ──────────────────────────────────────────────

	function upsertUserRecord(email: string, displayName: string | null): RemoteUserRecord {
		const existing = db
			.prepare("SELECT uuid, email, display_name, created_at FROM remote_users WHERE email = ?")
			.get(email) as unknown as
			| { uuid: string; email: string; display_name: string | null; created_at: number }
			| undefined;

		if (existing) {
			// Update display_name if we now have a better one.
			if (displayName && displayName !== existing.display_name) {
				db.prepare("UPDATE remote_users SET display_name = ? WHERE uuid = ?").run(displayName, existing.uuid);
			}
			return {
				uuid: existing.uuid,
				email: existing.email,
				displayName: displayName ?? existing.display_name,
				createdAt: existing.created_at,
			};
		}

		const uuid = randomBytes(16)
			.toString("hex")
			.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
		const resolvedName = displayName ?? displayNameFromEmail(email);
		db.prepare("INSERT INTO remote_users (uuid, email, display_name, created_at) VALUES (?, ?, ?, ?)").run(
			uuid,
			email,
			resolvedName,
			Date.now(),
		);
		return { uuid, email, displayName: resolvedName, createdAt: Date.now() };
	}

	return {
		isLocal: isLocalRequest,

		getOrCreateUserRecord(email: string, displayName: string | null): RemoteUserRecord {
			return upsertUserRecord(email, displayName);
		},

		async createSession({ email, userId, displayName, persistent }) {
			const userRecord = upsertUserRecord(email, displayName);
			const sessionId = generateSessionId();
			const now = Date.now();
			const ttl = persistent ? PERSISTENT_SESSION_TTL_MS : SESSION_TTL_MS;
			const expiresAt = now + ttl;
			const resolvedDisplayName = userRecord.displayName ?? displayNameFromEmail(email);

			db.prepare(
				"INSERT INTO remote_sessions (id, email, user_id, user_uuid, display_name, issued_at, expires_at, last_seen, persistent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			).run(
				sessionId,
				email,
				userId ?? null,
				userRecord.uuid,
				resolvedDisplayName,
				now,
				expiresAt,
				now,
				persistent ? 1 : 0,
			);

			const token = await new SignJWT({ sid: sessionId, email, uid: userId ?? null })
				.setProtectedHeader({ alg: JWT_ALGORITHM })
				.setIssuedAt()
				.setExpirationTime(Math.floor(expiresAt / 1000))
				.sign(signingSecret);

			const maxAge = Math.floor(ttl / 1000);
			return { cookie: cookieHeader(token, maxAge), token };
		},

		async validateSession(cookieOrToken: string): Promise<RemoteSession | null> {
			// Accept either a raw JWT or a full Cookie header.
			const token = cookieOrToken.includes("=")
				? (extractTokenFromCookie(cookieOrToken) ?? cookieOrToken)
				: cookieOrToken;

			if (!token) return null;

			let sessionId: string;
			try {
				const { payload } = await jwtVerify(token, signingSecret, { algorithms: [JWT_ALGORITHM] });
				sessionId = payload.sid as string;
			} catch {
				return null;
			}

			const row = db
				.prepare(
					"SELECT id, email, user_id, user_uuid, display_name, issued_at, expires_at, last_seen, persistent FROM remote_sessions WHERE id = ?",
				)
				.get(sessionId) as unknown as RemoteSessionRecord | undefined;

			if (!row) return null;
			if (row.expiresAt < Date.now()) {
				db.prepare("DELETE FROM remote_sessions WHERE id = ?").run(sessionId);
				return null;
			}

			return {
				sessionId: row.id,
				email: row.email,
				userId: row.userId,
				userUuid: row.userUuid,
				displayName: row.displayName ?? displayNameFromEmail(row.email),
				issuedAt: row.issuedAt,
				expiresAt: row.expiresAt,
				persistent: Number(row.persistent) === 1,
			};
		},

		async touchSession(sessionId: string): Promise<void> {
			const now = Date.now();
			const row = db.prepare("SELECT persistent FROM remote_sessions WHERE id = ?").get(sessionId) as unknown as
				| { persistent: number }
				| undefined;
			if (!row) return;
			const persistent = row.persistent === 1;
			if (persistent) {
				const newExpiry = now + PERSISTENT_SESSION_TTL_MS;
				db.prepare("UPDATE remote_sessions SET last_seen = ?, expires_at = ? WHERE id = ?").run(
					now,
					newExpiry,
					sessionId,
				);
			} else {
				db.prepare("UPDATE remote_sessions SET last_seen = ? WHERE id = ?").run(now, sessionId);
			}
		},

		revokeSession(sessionId: string): void {
			db.prepare("DELETE FROM remote_sessions WHERE id = ?").run(sessionId);
		},

		revokeAllSessionsForEmail(email: string): void {
			db.prepare("DELETE FROM remote_sessions WHERE email = ?").run(email);
		},

		listSessions(): RemoteSessionRecord[] {
			return db
				.prepare(
					"SELECT id, email, user_id, issued_at, expires_at, last_seen, persistent FROM remote_sessions WHERE expires_at > ? ORDER BY last_seen DESC",
				)
				.all(Date.now()) as unknown as RemoteSessionRecord[];
		},

		async hashPassword(password: string): Promise<string> {
			const salt = randomBytes(16).toString("hex");
			const derivedKey = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
			return `${salt}:${derivedKey.toString("hex")}`;
		},

		async verifyPassword(input: string, storedHash: string): Promise<boolean> {
			const [salt, hash] = storedHash.split(":") as [string, string];
			if (!salt || !hash) return false;
			try {
				const inputKey = (await scryptAsync(input, salt, SCRYPT_KEYLEN)) as Buffer;
				const storedKey = Buffer.from(hash, "hex");
				if (inputKey.length !== storedKey.length) return false;
				return timingSafeEqual(inputKey, storedKey);
			} catch {
				return false;
			}
		},

		clearCookie(): string {
			return `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`;
		},

		pushManager,

		close(): void {
			db.close?.();
		},
	};
}

// ── HMAC token helpers (for non-cookie API bearer tokens) ─────────────────

// Generates a secure random bearer token (used for API clients that cannot
// use cookies, e.g. the CARD PWA or CLI tools).
export function generateBearerToken(): string {
	return randomBytes(32).toString("base64url");
}

// Constant-time comparison for bearer tokens.
export function compareBearerTokens(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	if (bufA.length !== bufB.length) {
		// Still run a dummy comparison to prevent timing leaks.
		createHmac("sha256", "dummy").update(bufA).digest();
		return false;
	}
	return timingSafeEqual(bufA, bufB);
}
