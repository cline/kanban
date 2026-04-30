import { useCallback, useEffect, useRef, useState } from "react";

import { fetchRuntimeUpdateStatus } from "@/runtime/runtime-config-query";

const UPDATE_POLL_INTERVAL_MS = 60 * 60 * 1000; // 1h: backend only refreshes on startup anyway.

interface AvailableUpdate {
	currentVersion: string;
	latestVersion: string;
	installCommand: string;
}

interface UseUpdateNotificationResult {
	availableUpdate: AvailableUpdate | null;
	dismiss: () => void;
}

/**
 * Polls the runtime for update status and surfaces a pending update for the UI
 * to render. Relies on the runtime's startup auto-update check: the server
 * side populates the pending notification asynchronously, so we check once on
 * mount, retry once shortly after, then fall back to a slow poll. The user
 * can dismiss the prompt for the current session via {@link UseUpdateNotificationResult.dismiss}.
 */
export function useUpdateNotification(): UseUpdateNotificationResult {
	const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
	const dismissedRef = useRef(false);

	const dismiss = useCallback(() => {
		dismissedRef.current = true;
		setAvailableUpdate(null);
	}, []);

	useEffect(() => {
		let cancelled = false;

		async function checkOnce(): Promise<void> {
			if (dismissedRef.current) {
				return;
			}
			try {
				const status = await fetchRuntimeUpdateStatus(null);
				if (cancelled || dismissedRef.current) {
					return;
				}
				if (!status.updateAvailable || !status.latestVersion || !status.installCommand) {
					// Self-correct if a previous poll surfaced an update that has since
					// been cleared (e.g. the user applied the update and the runtime
					// cleared the pending notification).
					setAvailableUpdate(null);
					return;
				}
				setAvailableUpdate({
					currentVersion: status.currentVersion,
					latestVersion: status.latestVersion,
					installCommand: status.installCommand,
				});
			} catch {
				// Update status is a best-effort nudge; ignore failures.
			}
		}

		void checkOnce();

		// The server's pending-update state is populated asynchronously after
		// startup, so give it a couple of retries shortly after mount before
		// falling back to the slow poll interval.
		const earlyRetry = setTimeout(() => {
			void checkOnce();
		}, 10_000);
		const interval = setInterval(() => {
			void checkOnce();
		}, UPDATE_POLL_INTERVAL_MS);

		return () => {
			cancelled = true;
			clearTimeout(earlyRetry);
			clearInterval(interval);
		};
	}, []);

	return { availableUpdate, dismiss };
}
