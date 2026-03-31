// VAPID-based Web Push notification manager.
//
// Responsibilities:
//   - Generate and persist VAPID key pair (encrypted at rest in remote.db).
//   - Store push subscriptions per user with per-event preference flags.
//   - Deliver push notifications to eligible subscriptions.
//   - Automatically clean up expired (HTTP 410/404) subscriptions.
//
// The PushManager is created once at server startup and reuses the same
// open SQLite connection as RemoteAuth — no second DB file or connection.
//
// Events that can trigger notifications:
//   ready_for_review   — agent finished a turn and awaits human review
//   agent_question     — agent needs user input (reviewReason === "attention")
//   session_started    — an agent session was started
//   team_chat          — a team chat message was sent
//   moved_to_review    — a card was moved to the review column

import type { loadSqliteDb } from "@clinebot/shared/db";
import webpush from "web-push";

// ── Types ───────────────────────────────────────────────────────────────────

export type PushNotificationEvent =
	| "ready_for_review"
	| "agent_question"
	| "session_started"
	| "team_chat"
	| "moved_to_review";

export interface PushSubscriptionInput {
	endpoint: string;
	keys: { p256dh: string; auth: string };
}

export interface PushSubscriptionPreferences {
	notifyReadyForReview: boolean;
	notifyAgentQuestion: boolean;
	notifySessionStarted: boolean;
	notifyTeamChat: boolean;
	notifyMovedToReview: boolean;
}

export interface PushSubscriptionRecord {
	id: string;
	userUuid: string;
	userEmail: string;
	endpoint: string;
	createdAt: number;
	lastUsed: number | null;
	preferences: PushSubscriptionPreferences;
}

export interface SendPushOptions {
	event: PushNotificationEvent;
	workspaceId: string;
	title: string;
	body: string;
	data?: Record<string, unknown>;
	// When provided, only subscriptions for these user UUIDs receive the notification.
	// Omit to send to all subscribers who have the event enabled.
	targetUserUuids?: string[];
}

// Column name → preference field mapping.
const EVENT_COLUMN: Record<PushNotificationEvent, string> = {
	ready_for_review: "notify_ready_for_review",
	agent_question: "notify_agent_question",
	session_started: "notify_session_started",
	team_chat: "notify_team_chat",
	moved_to_review: "notify_moved_to_review",
};

export interface PushManager {
	// URL-safe base64 VAPID public key — needed by the frontend to subscribe.
	getPublicKey(): string;

	// Register or update a push subscription for a user. Upserts by endpoint.
	saveSubscription(userUuid: string, userEmail: string, sub: PushSubscriptionInput): string;

	// Remove a single subscription by endpoint.
	removeSubscription(endpoint: string): void;

	// Remove all subscriptions for a user (e.g. on account deletion).
	removeAllSubscriptionsForUser(userUuid: string): void;

	// Returns all subscriptions for a user, with their current preferences.
	listSubscriptionsForUser(userUuid: string): PushSubscriptionRecord[];

	// Returns every subscription (admin view).
	listAllSubscriptions(): PushSubscriptionRecord[];

	// Update per-event notification preferences on a specific subscription.
	updatePreferences(subscriptionId: string, prefs: Partial<PushSubscriptionPreferences>): void;

	// Deliver a push notification to all eligible subscriptions.
	// Expired subscriptions (HTTP 410/404) are removed automatically.
	send(opts: SendPushOptions): Promise<void>;
}

// ── Schema helpers ───────────────────────────────────────────────────────────

type SqliteDb = Awaited<ReturnType<typeof loadSqliteDb>>;

function ensurePushSchema(db: SqliteDb): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS remote_vapid_keys (
			id              INTEGER PRIMARY KEY CHECK (id = 1),
			public_key      TEXT    NOT NULL,
			private_key_enc TEXT    NOT NULL,
			created_at      INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS remote_push_subscriptions (
			id                      TEXT    PRIMARY KEY,
			user_uuid               TEXT    NOT NULL,
			user_email              TEXT    NOT NULL,
			endpoint                TEXT    NOT NULL UNIQUE,
			p256dh                  TEXT    NOT NULL,
			auth                    TEXT    NOT NULL,
			created_at              INTEGER NOT NULL,
			last_used               INTEGER,
			notify_ready_for_review INTEGER NOT NULL DEFAULT 1,
			notify_agent_question   INTEGER NOT NULL DEFAULT 1,
			notify_session_started  INTEGER NOT NULL DEFAULT 1,
			notify_team_chat        INTEGER NOT NULL DEFAULT 1,
			notify_moved_to_review  INTEGER NOT NULL DEFAULT 1
		);
		CREATE INDEX IF NOT EXISTS idx_push_subs_user
			ON remote_push_subscriptions (user_uuid);
	`);
}

// ── Row → domain type ────────────────────────────────────────────────────────

interface PushSubRow {
	id: string;
	user_uuid: string;
	user_email: string;
	endpoint: string;
	p256dh: string;
	auth: string;
	created_at: number;
	last_used: number | null;
	notify_ready_for_review: number;
	notify_agent_question: number;
	notify_session_started: number;
	notify_team_chat: number;
	notify_moved_to_review: number;
}

function rowToRecord(row: PushSubRow): PushSubscriptionRecord {
	return {
		id: row.id,
		userUuid: row.user_uuid,
		userEmail: row.user_email,
		endpoint: row.endpoint,
		createdAt: row.created_at,
		lastUsed: row.last_used ?? null,
		preferences: {
			notifyReadyForReview: row.notify_ready_for_review === 1,
			notifyAgentQuestion: row.notify_agent_question === 1,
			notifySessionStarted: row.notify_session_started === 1,
			notifyTeamChat: row.notify_team_chat === 1,
			notifyMovedToReview: row.notify_moved_to_review === 1,
		},
	};
}

// ── Factory ───────────────────────────────────────────────────────────────────

export async function createPushManager(
	db: SqliteDb,
	encryptFn: (plaintext: string) => string,
	decryptFn: (stored: string) => string,
): Promise<PushManager> {
	ensurePushSchema(db);

	// Load or generate VAPID keys.
	const VAPID_CONTACT = "mailto:kanban@cline.bot";

	let vapidPublicKey: string;
	let vapidPrivateKey: string;

	const existingRow = db
		.prepare("SELECT public_key, private_key_enc FROM remote_vapid_keys WHERE id = 1")
		.get() as unknown as { public_key: string; private_key_enc: string } | undefined;

	if (existingRow) {
		vapidPublicKey = existingRow.public_key;
		vapidPrivateKey = decryptFn(existingRow.private_key_enc);
	} else {
		const keys = webpush.generateVAPIDKeys();
		vapidPublicKey = keys.publicKey;
		vapidPrivateKey = keys.privateKey;
		const encryptedPrivate = encryptFn(vapidPrivateKey);
		db.prepare("INSERT INTO remote_vapid_keys (id, public_key, private_key_enc, created_at) VALUES (1, ?, ?, ?)").run(
			vapidPublicKey,
			encryptedPrivate,
			Date.now(),
		);
	}

	webpush.setVapidDetails(VAPID_CONTACT, vapidPublicKey, vapidPrivateKey);

	// ── Helpers ────────────────────────────────────────────────────────────

	function generateId(): string {
		return `ps-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	}

	function querySubscriptions(event: PushNotificationEvent, targetUserUuids?: string[]): PushSubRow[] {
		const col = EVENT_COLUMN[event];
		if (targetUserUuids && targetUserUuids.length > 0) {
			const placeholders = targetUserUuids.map(() => "?").join(",");
			return db
				.prepare(`SELECT * FROM remote_push_subscriptions WHERE ${col} = 1 AND user_uuid IN (${placeholders})`)
				.all(...targetUserUuids) as unknown as PushSubRow[];
		}
		return db.prepare(`SELECT * FROM remote_push_subscriptions WHERE ${col} = 1`).all() as unknown as PushSubRow[];
	}

	// ── Implementation ─────────────────────────────────────────────────────

	return {
		getPublicKey(): string {
			return vapidPublicKey;
		},

		saveSubscription(userUuid: string, userEmail: string, sub: PushSubscriptionInput): string {
			// Upsert by endpoint — if the endpoint already exists, update keys and user info.
			const existing = db
				.prepare("SELECT id FROM remote_push_subscriptions WHERE endpoint = ?")
				.get(sub.endpoint) as unknown as { id: string } | undefined;

			if (existing) {
				db.prepare(
					"UPDATE remote_push_subscriptions SET user_uuid = ?, user_email = ?, p256dh = ?, auth = ? WHERE id = ?",
				).run(userUuid, userEmail, sub.keys.p256dh, sub.keys.auth, existing.id);
				return existing.id;
			}

			const id = generateId();
			db.prepare(
				`INSERT INTO remote_push_subscriptions
					(id, user_uuid, user_email, endpoint, p256dh, auth, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
			).run(id, userUuid, userEmail, sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now());
			return id;
		},

		removeSubscription(endpoint: string): void {
			db.prepare("DELETE FROM remote_push_subscriptions WHERE endpoint = ?").run(endpoint);
		},

		removeAllSubscriptionsForUser(userUuid: string): void {
			db.prepare("DELETE FROM remote_push_subscriptions WHERE user_uuid = ?").run(userUuid);
		},

		listSubscriptionsForUser(userUuid: string): PushSubscriptionRecord[] {
			const rows = db
				.prepare("SELECT * FROM remote_push_subscriptions WHERE user_uuid = ? ORDER BY created_at DESC")
				.all(userUuid) as unknown as PushSubRow[];
			return rows.map(rowToRecord);
		},

		listAllSubscriptions(): PushSubscriptionRecord[] {
			const rows = db
				.prepare("SELECT * FROM remote_push_subscriptions ORDER BY user_email, created_at DESC")
				.all() as unknown as PushSubRow[];
			return rows.map(rowToRecord);
		},

		updatePreferences(subscriptionId: string, prefs: Partial<PushSubscriptionPreferences>): void {
			const updates: string[] = [];
			const values: unknown[] = [];

			if (prefs.notifyReadyForReview !== undefined) {
				updates.push("notify_ready_for_review = ?");
				values.push(prefs.notifyReadyForReview ? 1 : 0);
			}
			if (prefs.notifyAgentQuestion !== undefined) {
				updates.push("notify_agent_question = ?");
				values.push(prefs.notifyAgentQuestion ? 1 : 0);
			}
			if (prefs.notifySessionStarted !== undefined) {
				updates.push("notify_session_started = ?");
				values.push(prefs.notifySessionStarted ? 1 : 0);
			}
			if (prefs.notifyTeamChat !== undefined) {
				updates.push("notify_team_chat = ?");
				values.push(prefs.notifyTeamChat ? 1 : 0);
			}
			if (prefs.notifyMovedToReview !== undefined) {
				updates.push("notify_moved_to_review = ?");
				values.push(prefs.notifyMovedToReview ? 1 : 0);
			}

			if (updates.length === 0) return;
			values.push(subscriptionId);
			db.prepare(`UPDATE remote_push_subscriptions SET ${updates.join(", ")} WHERE id = ?`).run(...values);
		},

		async send(opts: SendPushOptions): Promise<void> {
			const rows = querySubscriptions(opts.event, opts.targetUserUuids);
			if (rows.length === 0) return;

			const payload = JSON.stringify({
				title: opts.title,
				body: opts.body,
				data: {
					event: opts.event,
					workspaceId: opts.workspaceId,
					...(opts.data ?? {}),
				},
			});

			const expiredEndpoints: string[] = [];

			await Promise.allSettled(
				rows.map(async (row) => {
					try {
						await webpush.sendNotification(
							{ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
							payload,
						);
						db.prepare("UPDATE remote_push_subscriptions SET last_used = ? WHERE id = ?").run(Date.now(), row.id);
					} catch (err) {
						const statusCode = (err as { statusCode?: number }).statusCode;
						if (statusCode === 410 || statusCode === 404) {
							expiredEndpoints.push(row.endpoint);
						}
						// Other errors (network timeout, etc.) are ignored — try again on next event.
					}
				}),
			);

			// Remove expired subscriptions in bulk.
			for (const endpoint of expiredEndpoints) {
				db.prepare("DELETE FROM remote_push_subscriptions WHERE endpoint = ?").run(endpoint);
			}
		},
	};
}
