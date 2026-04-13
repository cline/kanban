export enum LocalStorageKey {
	TaskStartInPlanMode = "kanban.task-start-in-plan-mode",
	TaskAutoReviewEnabled = "kanban.task-auto-review-enabled",
	TaskAutoReviewMode = "kanban.task-auto-review-mode",
	AgentTipsDismissed = "kanban.agent-tips-dismissed",
	TaskCreatePrimaryStartAction = "kanban.task-create-primary-start-action",
	BottomTerminalPaneHeight = "kanban.bottom-terminal-pane-height",
	DetailAgentPanelRatio = "kanban.detail-agent-panel-ratio",
	DetailTaskCardsPanelRatio = "kanban.detail-task-cards-panel-ratio",
	DetailDiffFileTreePanelRatio = "kanban.detail-diff-file-tree-panel-ratio",
	DetailExpandedDiffFileTreePanelRatio = "kanban.detail-expanded-diff-file-tree-panel-ratio",
	ProjectNavigationPanelWidth = "kb-sidebar-width",
	ProjectNavigationPanelCollapsed = "kanban.project-navigation-panel-collapsed",
	GitHistoryRefsPanelWidth = "kanban.git-history-refs-panel-width",
	GitHistoryCommitsPanelWidth = "kanban.git-history-commits-panel-width",
	GitDiffFileTreePanelRatio = "kanban.git-diff-file-tree-panel-ratio",
	DetailDiffFileTreeVisible = "kanban.detail-diff-file-tree-visible",
	GitDiffFileTreeVisible = "kanban.git-diff-file-tree-visible",
	OnboardingDialogShown = "kanban.onboarding.dialog.shown",
	NotificationPermissionPrompted = "kanban.notifications.permission-prompted",
	PreferredOpenTarget = "kanban.preferred-open-target",
	NotificationBadgeClearEvent = "kanban.notification-badge-clear.v1",
	TabVisibilityPresence = "kanban.tab-visibility-presence.v1",
	Theme = "kanban.theme",
}

export const LAYOUT_CUSTOMIZATION_LOCAL_STORAGE_KEYS = [
	LocalStorageKey.BottomTerminalPaneHeight,
	LocalStorageKey.DetailAgentPanelRatio,
	LocalStorageKey.DetailTaskCardsPanelRatio,
	LocalStorageKey.DetailDiffFileTreePanelRatio,
	LocalStorageKey.DetailExpandedDiffFileTreePanelRatio,
	LocalStorageKey.ProjectNavigationPanelWidth,
	LocalStorageKey.ProjectNavigationPanelCollapsed,
	LocalStorageKey.GitHistoryRefsPanelWidth,
	LocalStorageKey.GitHistoryCommitsPanelWidth,
	LocalStorageKey.GitDiffFileTreePanelRatio,
] as const;

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

export function removeLocalStorageItem(key: LocalStorageKey): void {
	const storage = getLocalStorage();
	if (!storage) {
		return;
	}
	try {
		storage.removeItem(key);
	} catch {
		// Ignore storage removal failures.
	}
}

export function resetLayoutCustomizationLocalStorageItems(): void {
	for (const key of LAYOUT_CUSTOMIZATION_LOCAL_STORAGE_KEYS) {
		removeLocalStorageItem(key);
	}
}
