import { useCallback, useEffect, useRef, useState } from "react";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

export type PushSubscriptionState = "unsupported" | "default" | "denied" | "subscribed" | "loading";

function isPushSupported(): boolean {
	return (
		typeof window !== "undefined" &&
		"PushManager" in window &&
		"Notification" in window &&
		"serviceWorker" in navigator
	);
}

/**
 * Convert a URL-safe base64 string to a Uint8Array for use as applicationServerKey.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
	const rawData = atob(base64);
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; i++) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
}

interface UsePushNotificationsOptions {
	workspaceId: string | null;
}

interface UsePushNotificationsResult {
	state: PushSubscriptionState;
	subscribe: () => Promise<void>;
	unsubscribe: () => Promise<void>;
	error: string | null;
}

export function usePushNotifications({ workspaceId }: UsePushNotificationsOptions): UsePushNotificationsResult {
	const [state, setState] = useState<PushSubscriptionState>(() => {
		if (!isPushSupported()) {
			return "unsupported";
		}
		return "loading";
	});
	const [error, setError] = useState<string | null>(null);
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	// Check existing subscription on mount and re-sync it to the server.
	// iOS can rotate push subscription endpoints when the service worker is
	// killed and restarted in the background.  Re-sending on every page load
	// ensures the server always has the current endpoint.
	useEffect(() => {
		if (!isPushSupported()) {
			return;
		}

		void (async () => {
			try {
				const permission = Notification.permission;
				if (permission === "denied") {
					if (mountedRef.current) {
						setState("denied");
					}
					return;
				}

				const registration = await navigator.serviceWorker.ready;
				const existingSubscription = await registration.pushManager.getSubscription();

				if (!mountedRef.current) {
					return;
				}

				if (existingSubscription) {
					// Re-sync the subscription to the server so stale endpoints
					// (e.g. after iOS restarts the service worker) are replaced.
					const json = existingSubscription.toJSON();
					if (json.endpoint && json.keys && workspaceId) {
						const client = getRuntimeTrpcClient(workspaceId);
						await client.push.subscribe.mutate({
							endpoint: json.endpoint,
							expirationTime: json.expirationTime ?? null,
							keys: {
								p256dh: json.keys.p256dh ?? "",
								auth: json.keys.auth ?? "",
							},
						});
					}
					if (mountedRef.current) {
						setState("subscribed");
					}
				} else if (permission === "default") {
					setState("default");
				} else {
					// granted but no subscription
					setState("default");
				}
			} catch {
				if (mountedRef.current) {
					setState("default");
				}
			}
		})();
	}, [workspaceId]);

	const subscribe = useCallback(async () => {
		if (!isPushSupported()) {
			return;
		}

		setError(null);

		try {
			const permission = await Notification.requestPermission();
			if (!mountedRef.current) {
				return;
			}

			if (permission === "denied") {
				setState("denied");
				return;
			}

			if (permission !== "granted") {
				setState("default");
				return;
			}

			setState("loading");

			const client = getRuntimeTrpcClient(workspaceId);
			const { vapidPublicKey } = await client.push.getVapidPublicKey.query();

			const registration = await navigator.serviceWorker.ready;
			const subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
			});

			const subscriptionJson = subscription.toJSON();
			if (!subscriptionJson.endpoint || !subscriptionJson.keys) {
				throw new Error("Push subscription missing required fields");
			}

			await client.push.subscribe.mutate({
				endpoint: subscriptionJson.endpoint,
				expirationTime: subscriptionJson.expirationTime ?? null,
				keys: {
					p256dh: subscriptionJson.keys.p256dh ?? "",
					auth: subscriptionJson.keys.auth ?? "",
				},
			});

			if (mountedRef.current) {
				setState("subscribed");
			}
		} catch (err) {
			if (mountedRef.current) {
				const message = err instanceof Error ? err.message : "Failed to subscribe to push notifications";
				setError(message);
				setState("default");
			}
		}
	}, [workspaceId]);

	const unsubscribe = useCallback(async () => {
		if (!isPushSupported()) {
			return;
		}

		setError(null);

		try {
			setState("loading");

			const registration = await navigator.serviceWorker.ready;
			const subscription = await registration.pushManager.getSubscription();

			if (subscription) {
				const endpoint = subscription.endpoint;
				await subscription.unsubscribe();

				const client = getRuntimeTrpcClient(workspaceId);
				await client.push.unsubscribe.mutate({ endpoint });
			}

			if (mountedRef.current) {
				setState("default");
			}
		} catch (err) {
			if (mountedRef.current) {
				const message = err instanceof Error ? err.message : "Failed to unsubscribe from push notifications";
				setError(message);
			}
		}
	}, [workspaceId]);

	return { state, subscribe, unsubscribe, error };
}
