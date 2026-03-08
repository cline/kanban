import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/kanban/storage/local-storage-store";

export type BrowserNotificationPermission = NotificationPermission | "unsupported";

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
	if (typeof Notification === "undefined") {
		return "unsupported";
	}
	return Notification.permission;
}

function readPromptedFlag(): boolean {
	return readLocalStorageItem(LocalStorageKey.NotificationPermissionPrompted) === "true";
}

function writePromptedFlag(value: boolean): void {
	writeLocalStorageItem(LocalStorageKey.NotificationPermissionPrompted, String(value));
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
