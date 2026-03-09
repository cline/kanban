export enum LocalStorageKey {
	TaskStartInPlanMode = "kanbanana.task-start-in-plan-mode",
	TaskAutoReviewEnabled = "kanbanana.task-auto-review-enabled",
	TaskAutoReviewMode = "kanbanana.task-auto-review-mode",
	NotificationPermissionPrompted = "kanbanana.notifications.permission-prompted",
	PreferredOpenTarget = "kanbanana.preferred-open-target",
	NotificationBadgeClearEvent = "kanbanana.notification-badge-clear.v1",
	TabVisibilityPresence = "kanbanana.tab-visibility-presence.v1",
}

function getLocalStorage(): Storage | null {
	if (typeof window === "undefined") {
		return null;
	}
	return window.localStorage;
}

export function readLocalStorageItem(key: LocalStorageKey): string | null {
	const storage = getLocalStorage();
	if (!storage) {
		return null;
	}
	try {
		return storage.getItem(key);
	} catch {
		return null;
	}
}

export function writeLocalStorageItem(key: LocalStorageKey, value: string): void {
	const storage = getLocalStorage();
	if (!storage) {
		return;
	}
	try {
		storage.setItem(key, value);
	} catch {
		// Ignore storage write failures.
	}
}
