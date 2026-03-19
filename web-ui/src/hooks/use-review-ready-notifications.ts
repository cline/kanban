import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeStateStreamTaskReadyForReviewMessage, RuntimeTaskSessionSummary } from "@/runtime/types";
import { findCardSelection } from "@/state/board-state";
import type { BoardData } from "@/types";
import {
	broadcastNotificationBadgeClear,
	createNotificationBadgeSyncSourceId,
	subscribeToNotificationBadgeClear,
} from "@/utils/notification-badge-sync";
import { getBrowserNotificationPermission } from "@/utils/notification-permission";
import { useDocumentTitle, useInterval, useUnmount, useWindowEvent } from "@/utils/react-use";
import {
	createTabPresenceId,
	hasVisibleKanbanTabForWorkspace,
	markTabHidden,
	markTabVisible,
} from "@/utils/tab-visibility-presence";
import { truncateTaskPromptLabel } from "@/utils/task-prompt";

interface UseReviewReadyNotificationsOptions {
	activeWorkspaceId: string | null;
	board: BoardData;
	isDocumentVisible: boolean;
	latestTaskReadyForReview: RuntimeStateStreamTaskReadyForReviewMessage | null;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	readyForReviewNotificationsEnabled: boolean;
	workspacePath: string | null;
}

const MAX_HANDLED_READY_EVENT_KEYS = 200;
const TAB_VISIBILITY_HEARTBEAT_INTERVAL_MS = 5000;

function canShowBrowserNotifications(): boolean {
	return getBrowserNotificationPermission() === "granted";
}

function isDocumentCurrentlyVisible(fallbackValue: boolean): boolean {
	if (typeof document === "undefined") {
		return fallbackValue;
	}
	return document.visibilityState === "visible";
}

function resolveReviewReadyNotificationBody(
	taskId: string,
	taskTitle: string,
	taskSessions: Record<string, RuntimeTaskSessionSummary>,
): string {
	const finalMessage = taskSessions[taskId]?.latestHookActivity?.finalMessage?.trim();
	return finalMessage || taskTitle;
}

function showReadyForReviewNotification(taskId: string, notificationTitle: string, notificationBody: string): void {
	if (!canShowBrowserNotifications()) {
		return;
	}
	try {
		const notification = new Notification(notificationTitle, {
			body: notificationBody,
			tag: `task-ready-for-review-${taskId}`,
		});
		notification.onclick = () => {
			if (typeof window !== "undefined") {
				window.focus();
			}
			notification.close();
		};
	} catch {
		// Ignore browser notification failures.
	}
}

export function useReviewReadyNotifications({
	activeWorkspaceId,
	board,
	isDocumentVisible,
	latestTaskReadyForReview,
	taskSessions,
	readyForReviewNotificationsEnabled,
	workspacePath,
}: UseReviewReadyNotificationsOptions): void {
	const notificationPresenceTabIdRef = useRef<string>(createTabPresenceId());
	const notificationBadgeSyncSourceIdRef = useRef<string>(createNotificationBadgeSyncSourceId());
	const handledReadyForReviewEventKeysRef = useRef<Set<string>>(new Set());
	const handledReadyForReviewEventKeyQueueRef = useRef<string[]>([]);
	const [pendingReviewReadyNotificationCount, setPendingReviewReadyNotificationCount] = useState(0);
	const [isWindowFocused, setIsWindowFocused] = useState(() => {
		if (typeof document === "undefined") {
			return true;
		}
		return document.hasFocus();
	});
	const workspaceTitle = useMemo(() => {
		if (!workspacePath) {
			return null;
		}
		const segments = workspacePath
			.replaceAll("\\", "/")
			.split("/")
			.filter((segment) => segment.length > 0);
		if (segments.length === 0) {
			return workspacePath;
		}
		return segments[segments.length - 1] ?? workspacePath;
	}, [workspacePath]);
	const isAppActive = isDocumentVisible && isWindowFocused;

	useWindowEvent("focus", () => {
		setIsWindowFocused(true);
	});
	useWindowEvent("blur", () => {
		setIsWindowFocused(false);
	});

	useEffect(() => {
		const tabId = notificationPresenceTabIdRef.current;
		const syncSourceId = notificationBadgeSyncSourceIdRef.current;
		const presenceWorkspaceId = activeWorkspaceId;
		if (isAppActive) {
			if (presenceWorkspaceId) {
				markTabVisible(tabId, presenceWorkspaceId);
			} else {
				markTabHidden(tabId);
			}
			setPendingReviewReadyNotificationCount(0);
			broadcastNotificationBadgeClear(syncSourceId, presenceWorkspaceId);
		} else {
			markTabHidden(tabId);
		}
	}, [activeWorkspaceId, isAppActive]);

	useEffect(() => {
		if (activeWorkspaceId && isAppActive) {
			markTabVisible(notificationPresenceTabIdRef.current, activeWorkspaceId);
		}
	}, [activeWorkspaceId, isAppActive]);

	useInterval(
		() => {
			if (!activeWorkspaceId || !isAppActive) {
				return;
			}
			markTabVisible(notificationPresenceTabIdRef.current, activeWorkspaceId);
		},
		activeWorkspaceId && isAppActive ? TAB_VISIBILITY_HEARTBEAT_INTERVAL_MS : null,
	);

	useEffect(() => {
		if (!latestTaskReadyForReview) {
			return;
		}
		if (!activeWorkspaceId || latestTaskReadyForReview.workspaceId !== activeWorkspaceId) {
			return;
		}
		const eventKey = `${latestTaskReadyForReview.workspaceId}:${latestTaskReadyForReview.taskId}:${latestTaskReadyForReview.triggeredAt}`;
		if (handledReadyForReviewEventKeysRef.current.has(eventKey)) {
			return;
		}
		handledReadyForReviewEventKeysRef.current.add(eventKey);
		handledReadyForReviewEventKeyQueueRef.current.push(eventKey);
		if (handledReadyForReviewEventKeyQueueRef.current.length > MAX_HANDLED_READY_EVENT_KEYS) {
			const oldestKey = handledReadyForReviewEventKeyQueueRef.current.shift();
			if (oldestKey) {
				handledReadyForReviewEventKeysRef.current.delete(oldestKey);
			}
		}
		const isVisibleNow = isDocumentCurrentlyVisible(isDocumentVisible);
		const isWindowFocusedNow = typeof document === "undefined" ? isWindowFocused : document.hasFocus();
		const hasVisiblePeerTabForWorkspace = hasVisibleKanbanTabForWorkspace(
			latestTaskReadyForReview.workspaceId,
			notificationPresenceTabIdRef.current,
		);
		if (
			!readyForReviewNotificationsEnabled ||
			(isVisibleNow && isWindowFocusedNow) ||
			hasVisiblePeerTabForWorkspace
		) {
			return;
		}
		const selection = findCardSelection(board, latestTaskReadyForReview.taskId);
		const taskTitle = selection
			? truncateTaskPromptLabel(selection.card.prompt) || `Task ${latestTaskReadyForReview.taskId}`
			: `Task ${latestTaskReadyForReview.taskId}`;
		const notificationBody = resolveReviewReadyNotificationBody(
			latestTaskReadyForReview.taskId,
			taskTitle,
			taskSessions,
		);
		setPendingReviewReadyNotificationCount((current) => current + 1);
		const notificationTitle = workspaceTitle ? `${workspaceTitle} ready for review` : "Ready for review";
		showReadyForReviewNotification(latestTaskReadyForReview.taskId, notificationTitle, notificationBody);
	}, [
		activeWorkspaceId,
		board,
		isDocumentVisible,
		isWindowFocused,
		latestTaskReadyForReview,
		readyForReviewNotificationsEnabled,
		taskSessions,
		workspaceTitle,
	]);

	const handlePageHide = useCallback(() => {
		markTabHidden(notificationPresenceTabIdRef.current);
	}, []);
	useWindowEvent("pagehide", handlePageHide);
	useUnmount(() => {
		markTabHidden(notificationPresenceTabIdRef.current);
	});

	useEffect(() => {
		const syncSourceId = notificationBadgeSyncSourceIdRef.current;
		return subscribeToNotificationBadgeClear(syncSourceId, (workspaceId) => {
			if (workspaceId === activeWorkspaceId) {
				setPendingReviewReadyNotificationCount(0);
			}
		});
	}, [activeWorkspaceId]);

	useEffect(() => {
		if (!readyForReviewNotificationsEnabled) {
			setPendingReviewReadyNotificationCount(0);
			broadcastNotificationBadgeClear(notificationBadgeSyncSourceIdRef.current, activeWorkspaceId);
		}
	}, [activeWorkspaceId, readyForReviewNotificationsEnabled]);

	useEffect(() => {
		handledReadyForReviewEventKeysRef.current.clear();
		handledReadyForReviewEventKeyQueueRef.current = [];
		setPendingReviewReadyNotificationCount(0);
	}, [activeWorkspaceId]);

	const baseTitle = workspaceTitle || "cline";
	const documentTitle =
		pendingReviewReadyNotificationCount > 0 ? `(${pendingReviewReadyNotificationCount}) ${baseTitle}` : baseTitle;
	useDocumentTitle(documentTitle);
}
