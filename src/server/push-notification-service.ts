// Adapter that exposes PushNotificationService (used by cli.ts, runtime-server.ts,
// runtime-state-hub.ts, and push-api.ts) backed by our SQLite push-manager.
//
// This matches the interface from max/hackathon but stores subscriptions in
// remote.db via the existing PushManager rather than JSON files.

import type { RuntimePushSubscription } from "../core/api-contract";
import { createRemoteAuth } from "./remote-auth";

export interface PushNotificationPayload {
	title: string;
	body: string;
	url?: string;
	tag?: string;
}

export interface PushNotificationService {
	getVapidPublicKey: () => string;
	subscribe: (subscription: RuntimePushSubscription) => Promise<void>;
	unsubscribe: (endpoint: string) => Promise<void>;
	sendPushNotification: (payload: PushNotificationPayload) => Promise<void>;
}

// Lazily-created singleton so we don't open the DB multiple times.
let instance: PushNotificationService | null = null;

export async function createPushNotificationService(): Promise<PushNotificationService> {
	if (instance) return instance;

	// Reuse RemoteAuth's already-open DB connection for push.
	// RemoteAuth holds the PushManager which owns the remote_push_subscriptions table.
	const remoteAuth = await createRemoteAuth();
	const pushManager = remoteAuth.pushManager;

	instance = {
		getVapidPublicKey(): string {
			return pushManager.getPublicKey();
		},

		async subscribe(subscription: RuntimePushSubscription): Promise<void> {
			// Subscribe with a fallback user UUID when called from task lifecycle
			// code that has no session context. The subscription is linked to a
			// "system" account so it still receives broadcast notifications.
			const SYSTEM_UUID = "system-broadcast";
			const SYSTEM_EMAIL = "system@kanban";
			pushManager.saveSubscription(SYSTEM_UUID, SYSTEM_EMAIL, {
				endpoint: subscription.endpoint,
				keys: {
					p256dh: subscription.keys.p256dh,
					auth: subscription.keys.auth,
				},
			});
		},

		async unsubscribe(endpoint: string): Promise<void> {
			pushManager.removeSubscription(endpoint);
		},

		async sendPushNotification(payload: PushNotificationPayload): Promise<void> {
			await pushManager.send({
				event: "ready_for_review",
				workspaceId: "",
				title: payload.title,
				body: payload.body,
				data: {
					url: payload.url ?? "/",
					...(payload.tag ? { tag: payload.tag } : {}),
				},
			});
		},
	};

	return instance;
}
