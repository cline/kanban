import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { PushSubscription, VapidKeys } from "web-push";
import webPush from "web-push";
import { z } from "zod";

import type { RuntimePushSubscription } from "../core/api-contract";
import { lockedFileSystem } from "../fs/locked-file-system";
import { getRuntimeHomePath } from "../state/workspace-state";

const PUSH_DIR_NAME = "push";
const VAPID_KEYS_FILENAME = "vapid-keys.json";
const SUBSCRIPTIONS_FILENAME = "subscriptions.json";

const DEFAULT_VAPID_SUBJECT = "mailto:kanban@localhost";

const vapidKeysFileSchema = z.object({
	publicKey: z.string(),
	privateKey: z.string(),
});

const subscriptionsFileSchema = z.array(
	z.object({
		endpoint: z.string(),
		expirationTime: z.number().nullable().optional(),
		keys: z.object({
			p256dh: z.string(),
			auth: z.string(),
		}),
	}),
);

function getPushDirPath(): string {
	return join(getRuntimeHomePath(), PUSH_DIR_NAME);
}

function getVapidKeysPath(): string {
	return join(getPushDirPath(), VAPID_KEYS_FILENAME);
}

function getSubscriptionsPath(): string {
	return join(getPushDirPath(), SUBSCRIPTIONS_FILENAME);
}

async function readJsonFileOrNull<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
	const parsed: unknown = JSON.parse(raw);
	return schema.parse(parsed);
}

async function loadOrGenerateVapidKeys(): Promise<VapidKeys> {
	const path = getVapidKeysPath();
	const existing = await readJsonFileOrNull(path, vapidKeysFileSchema);
	if (existing) {
		return existing;
	}
	const keys = webPush.generateVAPIDKeys();
	await lockedFileSystem.writeJsonFileAtomic(path, keys);
	return keys;
}

async function loadSubscriptions(): Promise<PushSubscription[]> {
	const existing = await readJsonFileOrNull(getSubscriptionsPath(), subscriptionsFileSchema);
	return existing ?? [];
}

async function saveSubscriptions(subscriptions: PushSubscription[]): Promise<void> {
	await lockedFileSystem.writeJsonFileAtomic(getSubscriptionsPath(), subscriptions);
}

export interface PushNotificationPayload {
	title: string;
	body: string;
	url?: string;
}

export interface PushNotificationService {
	getVapidPublicKey: () => string;
	subscribe: (subscription: RuntimePushSubscription) => Promise<void>;
	unsubscribe: (endpoint: string) => Promise<void>;
	sendPushNotification: (payload: PushNotificationPayload) => Promise<void>;
}

export async function createPushNotificationService(options?: {
	vapidSubject?: string;
}): Promise<PushNotificationService> {
	const vapidSubject = options?.vapidSubject ?? DEFAULT_VAPID_SUBJECT;
	const vapidKeys = await loadOrGenerateVapidKeys();

	webPush.setVapidDetails(vapidSubject, vapidKeys.publicKey, vapidKeys.privateKey);

	const getVapidPublicKey = (): string => vapidKeys.publicKey;

	const subscribe = async (subscription: RuntimePushSubscription): Promise<void> => {
		const subscriptions = await loadSubscriptions();
		const existingIndex = subscriptions.findIndex((s) => s.endpoint === subscription.endpoint);
		const entry: PushSubscription = {
			endpoint: subscription.endpoint,
			expirationTime: subscription.expirationTime ?? null,
			keys: subscription.keys,
		};
		if (existingIndex >= 0) {
			subscriptions[existingIndex] = entry;
		} else {
			subscriptions.push(entry);
		}
		await saveSubscriptions(subscriptions);
	};

	const unsubscribe = async (endpoint: string): Promise<void> => {
		const subscriptions = await loadSubscriptions();
		const filtered = subscriptions.filter((s) => s.endpoint !== endpoint);
		if (filtered.length !== subscriptions.length) {
			await saveSubscriptions(filtered);
		}
	};

	const sendPushNotification = async (payload: PushNotificationPayload): Promise<void> => {
		const subscriptions = await loadSubscriptions();
		if (subscriptions.length === 0) {
			return;
		}
		const payloadString = JSON.stringify(payload);
		const expiredEndpoints: string[] = [];

		await Promise.allSettled(
			subscriptions.map(async (subscription) => {
				try {
					await webPush.sendNotification(subscription, payloadString);
				} catch (error) {
					if (error instanceof webPush.WebPushError && (error.statusCode === 410 || error.statusCode === 404)) {
						expiredEndpoints.push(subscription.endpoint);
					}
				}
			}),
		);

		if (expiredEndpoints.length > 0) {
			const endpointSet = new Set(expiredEndpoints);
			const remaining = subscriptions.filter((s) => !endpointSet.has(s.endpoint));
			await saveSubscriptions(remaining);
		}
	};

	return {
		getVapidPublicKey,
		subscribe,
		unsubscribe,
		sendPushNotification,
	};
}
