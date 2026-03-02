import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	broadcastNotificationBadgeClear,
	createNotificationBadgeSyncSourceId,
	subscribeToNotificationBadgeClear,
} from "@/kanban/utils/notification-badge-sync";
import {
	useDocumentTitle,
	useInterval,
	useUnmount,
	useWindowEvent,
} from "@/kanban/hooks/react-use";
import {
	getBrowserNotificationPermission,
} from "@/kanban/utils/notification-permission";
import {
	createTabPresenceId,
	hasVisibleKanbananaTabForWorkspace,
	markTabHidden,
	markTabVisible,
} from "@/kanban/utils/tab-visibility-presence";
import { findCardSelection } from "@/kanban/state/board-state";
import type { BoardData } from "@/kanban/types";
import type { RuntimeStateStreamTaskReadyForReviewMessage } from "@/kanban/runtime/types";

interface UseReviewReadyNotificationsOptions {
	activeWorkspaceId: string | null;
	board: BoardData;
	isDocumentVisible: boolean;
	latestTaskReadyForReview: RuntimeStateStreamTaskReadyForReviewMessage | null;
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

function showReadyForReviewNotification(taskId: string, notificationTitle: string, taskTitle: string): void {
	if (!canShowBrowserNotifications()) {
		return;
	}
	try {
		const notification = new Notification(notificationTitle, {
			body: taskTitle,
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
	readyForReviewNotificationsEnabled,
	workspacePath,
}: UseReviewReadyNotificationsOptions): void {
	const notificationPresenceTabIdRef = useRef<string>(createTabPresenceId());
	const notificationBadgeSyncSourceIdRef = useRef<string>(createNotificationBadgeSyncSourceId());
	const handledReadyForReviewEventKeysRef = useRef<Set<string>>(new Set());
	const handledReadyForReviewEventKeyQueueRef = useRef<string[]>([]);
	const [pendingReviewReadyNotificationCount, setPendingReviewReadyNotificationCount] = useState(0);
	const workspaceTitle = useMemo(() => {
		if (!workspacePath) {
			return null;
		}
		const segments = workspacePath.replaceAll("\\", "/").split("/").filter((segment) => segment.length > 0);
		if (segments.length === 0) {
			return workspacePath;
		}
		return segments[segments.length - 1] ?? workspacePath;
	}, [workspacePath]);

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
		const hasVisiblePeerTabForWorkspace = hasVisibleKanbananaTabForWorkspace(
			latestTaskReadyForReview.workspaceId,
			notificationPresenceTabIdRef.current,
		);
		if (
			!readyForReviewNotificationsEnabled ||
			isVisibleNow ||
			hasVisiblePeerTabForWorkspace
		) {
			return;
		}
		const selection = findCardSelection(board, latestTaskReadyForReview.taskId);
		const taskTitle = selection?.card.title?.trim() || `Task ${latestTaskReadyForReview.taskId}`;
		setPendingReviewReadyNotificationCount((current) => current + 1);
		const notificationTitle = workspaceTitle
			? `🍌 ${workspaceTitle} ready for review`
			: "🍌 Ready for review";
		showReadyForReviewNotification(latestTaskReadyForReview.taskId, notificationTitle, taskTitle);
	}, [
		activeWorkspaceId,
		board,
		isDocumentVisible,
		latestTaskReadyForReview,
		readyForReviewNotificationsEnabled,
		workspaceTitle,
	]);

	useEffect(() => {
		const tabId = notificationPresenceTabIdRef.current;
		const syncSourceId = notificationBadgeSyncSourceIdRef.current;
		const presenceWorkspaceId = activeWorkspaceId;
		if (isDocumentVisible) {
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
	}, [activeWorkspaceId, isDocumentVisible]);

	useEffect(() => {
		if (activeWorkspaceId && isDocumentVisible) {
			markTabVisible(notificationPresenceTabIdRef.current, activeWorkspaceId);
		}
	}, [activeWorkspaceId, isDocumentVisible]);

	useInterval(
		() => {
			if (!activeWorkspaceId || !isDocumentVisible) {
				return;
			}
			markTabVisible(notificationPresenceTabIdRef.current, activeWorkspaceId);
		},
		activeWorkspaceId && isDocumentVisible ? TAB_VISIBILITY_HEARTBEAT_INTERVAL_MS : null,
	);

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
			broadcastNotificationBadgeClear(
				notificationBadgeSyncSourceIdRef.current,
				activeWorkspaceId,
			);
		}
	}, [activeWorkspaceId, readyForReviewNotificationsEnabled]);

	useEffect(() => {
		handledReadyForReviewEventKeysRef.current.clear();
		handledReadyForReviewEventKeyQueueRef.current = [];
		setPendingReviewReadyNotificationCount(0);
	}, [activeWorkspaceId]);

	const baseTitle = workspaceTitle ? `${workspaceTitle} | Kanbanana` : "Kanbanana";
	const documentTitle = pendingReviewReadyNotificationCount > 0
		? `(${pendingReviewReadyNotificationCount}) ${baseTitle}`
		: baseTitle;
	useDocumentTitle(documentTitle);
}
