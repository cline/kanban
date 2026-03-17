export enum LocalStorageKey {
	TaskStartInPlanMode = "kanban.task-start-in-plan-mode",
	TaskAutoReviewEnabled = "kanban.task-auto-review-enabled",
	TaskAutoReviewMode = "kanban.task-auto-review-mode",
	TaskStartLinearSetupPromptDoNotShowAgain = "kanban.task-start-service-setup.linear.do-not-show-again",
	TaskStartGithubSetupPromptDoNotShowAgain = "kanban.task-start-service-setup.github.do-not-show-again",
	TaskStartAgentCliSetupPromptDoNotShowAgain = "kanban.task-start-service-setup.agent-cli.do-not-show-again",
	NotificationPermissionPrompted = "kanban.notifications.permission-prompted",
	PreferredOpenTarget = "kanban.preferred-open-target",
	NotificationBadgeClearEvent = "kanban.notification-badge-clear.v1",
	TabVisibilityPresence = "kanban.tab-visibility-presence.v1",
}

function isUsableStorage(storage: unknown): storage is Storage {
	if (typeof storage !== "object" || storage === null) {
		return false;
	}
	const candidate = storage as Partial<Storage>;
	return typeof candidate.getItem === "function" && typeof candidate.setItem === "function";
}

function getLocalStorage(): Storage | null {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		const storage = window.localStorage;
		return isUsableStorage(storage) ? storage : null;
	} catch {
		return null;
	}
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
