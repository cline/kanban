const NOTIFICATION_BADGE_CLEAR_EVENT_KEY = "kanbanana.notification-badge-clear.v1";

interface NotificationBadgeClearEvent {
	sourceId: string;
	workspaceId: string;
	triggeredAt: number;
}

function parseNotificationBadgeClearEvent(raw: string | null): NotificationBadgeClearEvent | null {
	if (!raw) {
		return null;
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") {
			return null;
		}
		const sourceId =
			"sourceId" in parsed && typeof parsed.sourceId === "string" ? parsed.sourceId.trim() : "";
		const workspaceId =
			"workspaceId" in parsed && typeof parsed.workspaceId === "string" ? parsed.workspaceId.trim() : "";
		const triggeredAt =
			"triggeredAt" in parsed && typeof parsed.triggeredAt === "number" ? parsed.triggeredAt : 0;
		if (!sourceId || !workspaceId || !Number.isFinite(triggeredAt)) {
			return null;
		}
		return {
			sourceId,
			workspaceId,
			triggeredAt,
		};
	} catch {
		return null;
	}
}

export function createNotificationBadgeSyncSourceId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `badge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function broadcastNotificationBadgeClear(
	sourceId: string,
	workspaceId: string | null | undefined,
): void {
	const normalizedWorkspaceId = workspaceId?.trim();
	if (!sourceId || !normalizedWorkspaceId || typeof window === "undefined") {
		return;
	}
	const payload: NotificationBadgeClearEvent = {
		sourceId,
		workspaceId: normalizedWorkspaceId,
		triggeredAt: Date.now(),
	};
	try {
		window.localStorage.setItem(NOTIFICATION_BADGE_CLEAR_EVENT_KEY, JSON.stringify(payload));
	} catch {
		// Ignore storage failures.
	}
}

export function subscribeToNotificationBadgeClear(
	sourceId: string,
	onClear: (workspaceId: string) => void,
): () => void {
	if (typeof window === "undefined") {
		return () => {};
	}
	const handleStorage = (event: StorageEvent) => {
		if (event.key !== NOTIFICATION_BADGE_CLEAR_EVENT_KEY) {
			return;
		}
		const payload = parseNotificationBadgeClearEvent(event.newValue);
		if (!payload || payload.sourceId === sourceId) {
			return;
		}
		onClear(payload.workspaceId);
	};
	window.addEventListener("storage", handleStorage);
	return () => {
		window.removeEventListener("storage", handleStorage);
	};
}
