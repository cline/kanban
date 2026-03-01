const NOTIFICATION_PERMISSION_PROMPTED_STORAGE_KEY = "kanbanana.notifications.permission-prompted";

export type BrowserNotificationPermission = NotificationPermission | "unsupported";

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
	if (typeof Notification === "undefined") {
		return "unsupported";
	}
	return Notification.permission;
}

function readPromptedFlag(): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	try {
		return window.localStorage.getItem(NOTIFICATION_PERMISSION_PROMPTED_STORAGE_KEY) === "true";
	} catch {
		return false;
	}
}

function writePromptedFlag(value: boolean): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(NOTIFICATION_PERMISSION_PROMPTED_STORAGE_KEY, String(value));
	} catch {
		// Ignore storage write failures.
	}
}

export function hasPromptedForBrowserNotificationPermission(): boolean {
	const permission = getBrowserNotificationPermission();
	if (permission === "granted" || permission === "denied") {
		return true;
	}
	return readPromptedFlag();
}

export function markBrowserNotificationPermissionPrompted(): void {
	writePromptedFlag(true);
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
	const permission = getBrowserNotificationPermission();
	if (permission === "unsupported") {
		return permission;
	}
	if (permission !== "default") {
		markBrowserNotificationPermissionPrompted();
		return permission;
	}
	try {
		const nextPermission = await Notification.requestPermission();
		markBrowserNotificationPermissionPrompted();
		return nextPermission;
	} catch {
		markBrowserNotificationPermissionPrompted();
		return getBrowserNotificationPermission();
	}
}
