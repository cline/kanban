// Push notification subscription management.
//
// Responsibilities:
//   - Subscribe the current browser to push notifications using the VAPID
//     public key fetched from the server.
//   - Register the resulting PushSubscription with the backend via
//     trpcClient.remote.push.subscribe.
//   - Expose subscription state so the settings UI can show a warning when
//     the browser has notification permission but is not registered.

import { useCallback, useEffect, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

// ── VAPID key conversion ───────────────────────────────────────────────────

// Convert a URL-safe base64 VAPID public key to the Uint8Array that
// pushManager.subscribe() expects as applicationServerKey.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
	const rawData = window.atob(base64);
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; i++) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
}

// ── Registration helper ────────────────────────────────────────────────────

// Subscribes this browser to push notifications and registers the subscription
// with the Kanban backend. Throws on failure.
export async function registerPushSubscription(workspaceId: string | null): Promise<void> {
	if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
		throw new Error("Push notifications are not supported in this browser.");
	}
	if (Notification.permission !== "granted") {
		throw new Error("Notification permission has not been granted.");
	}

	const trpc = getRuntimeTrpcClient(workspaceId);

	// Fetch the VAPID public key from the server.
	const { vapidPublicKey } = await trpc.remote.push.getVapidPublicKey.query();
	const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

	// Wait for the service worker to be ready.
	const registration = await navigator.serviceWorker.ready;

	// Check whether we already have a subscription.
	const existing = await registration.pushManager.getSubscription();
	if (existing) {
		// Re-register with the server in case it restarted and lost state.
		const subJson = existing.toJSON();
		if (subJson.endpoint && subJson.keys?.p256dh && subJson.keys?.auth) {
			await trpc.remote.push.subscribe.mutate({
				endpoint: subJson.endpoint,
				keys: { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth },
			});
		}
		return;
	}

	// Create a new push subscription.
	const subscription = await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
	});

	const subJson = subscription.toJSON();
	if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
		throw new Error("Push subscription is missing required fields.");
	}

	await trpc.remote.push.subscribe.mutate({
		endpoint: subJson.endpoint,
		keys: { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth },
	});
}

// ── Hook ───────────────────────────────────────────────────────────────────

export type PushSubscriptionStatus =
	| "unsupported" // PushManager / ServiceWorker not available
	| "permission-denied" // Notification.permission === "denied"
	| "not-subscribed" // Permission granted but not registered with backend
	| "subscribed" // Registered and confirmed with backend
	| "checking"; // Currently checking registration status

export interface UsePushSubscriptionResult {
	status: PushSubscriptionStatus;
	isRegistering: boolean;
	error: string | null;
	// Trigger manual re-registration (used by the warning button in settings).
	register: () => Promise<void>;
	// Re-check whether the current browser subscription matches the backend.
	refresh: () => void;
}

export function usePushSubscription(
	workspaceId: string | null,
	// Only run when the dialog/section is open to avoid unnecessary checks.
	enabled: boolean,
): UsePushSubscriptionResult {
	const [status, setStatus] = useState<PushSubscriptionStatus>("checking");
	const [isRegistering, setIsRegistering] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [refreshCounter, setRefreshCounter] = useState(0);

	// Check whether the browser's current push subscription is registered
	// with the backend. Runs on mount, on refresh, and whenever enabled toggles on.
	useEffect(() => {
		if (!enabled) return;

		// Quick environment check.
		if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
			setStatus("unsupported");
			return;
		}
		if (Notification.permission === "denied") {
			setStatus("permission-denied");
			return;
		}
		if (Notification.permission !== "granted") {
			setStatus("not-subscribed");
			return;
		}

		let cancelled = false;
		setStatus("checking");

		const check = async () => {
			try {
				const registration = await navigator.serviceWorker.ready;
				const browserSub = await registration.pushManager.getSubscription();

				if (!browserSub) {
					if (!cancelled) setStatus("not-subscribed");
					return;
				}

				// Check whether this endpoint is known to the backend.
				const trpc = getRuntimeTrpcClient(workspaceId);
				const { subscriptions } = await trpc.remote.push.listSubscriptions.query();
				const registered = subscriptions.some((s) => s.endpoint === browserSub.endpoint);

				if (!cancelled) setStatus(registered ? "subscribed" : "not-subscribed");
			} catch {
				if (!cancelled) setStatus("not-subscribed");
			}
		};

		void check();
		return () => {
			cancelled = true;
		};
	}, [enabled, workspaceId, refreshCounter]);

	const register = useCallback(async () => {
		setIsRegistering(true);
		setError(null);
		try {
			await registerPushSubscription(workspaceId);
			setStatus("subscribed");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Registration failed.");
			setStatus("not-subscribed");
		} finally {
			setIsRegistering(false);
		}
	}, [workspaceId]);

	const refresh = useCallback(() => {
		setRefreshCounter((c) => c + 1);
	}, []);

	return { status, isRegistering, error, register, refresh };
}
