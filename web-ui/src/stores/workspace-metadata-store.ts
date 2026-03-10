import { useSyncExternalStore } from "react";

import type { RuntimeGitSyncSummary, RuntimeTaskWorkspaceInfoResponse } from "@/runtime/types";
import type { ReviewTaskWorkspaceSnapshot } from "@/types";

type StoreListener = () => void;
type TaskMetadataListener = (taskId: string) => void;

interface WorkspaceMetadataState {
	homeGitSummary: RuntimeGitSyncSummary | null;
	taskWorkspaceInfoByTaskId: Record<string, RuntimeTaskWorkspaceInfoResponse | null>;
	taskWorkspaceSnapshotByTaskId: Record<string, ReviewTaskWorkspaceSnapshot | null>;
}

const workspaceMetadataState: WorkspaceMetadataState = {
	homeGitSummary: null,
	taskWorkspaceInfoByTaskId: {},
	taskWorkspaceSnapshotByTaskId: {},
};

const homeGitSummaryListeners = new Set<StoreListener>();
const taskMetadataListenersByTaskId = new Map<string, Set<StoreListener>>();
const anyTaskMetadataListeners = new Set<TaskMetadataListener>();

function emitHomeGitSummary(): void {
	for (const listener of homeGitSummaryListeners) {
		listener();
	}
}

function emitTaskMetadata(taskId: string): void {
	const listeners = taskMetadataListenersByTaskId.get(taskId);
	if (listeners) {
		for (const listener of listeners) {
			listener();
		}
	}
	for (const listener of anyTaskMetadataListeners) {
		listener(taskId);
	}
}

function subscribeToTaskId(taskId: string, listener: StoreListener): () => void {
	const listeners = taskMetadataListenersByTaskId.get(taskId) ?? new Set<StoreListener>();
	listeners.add(listener);
	taskMetadataListenersByTaskId.set(taskId, listeners);
	return () => {
		const current = taskMetadataListenersByTaskId.get(taskId);
		if (!current) {
			return;
		}
		current.delete(listener);
		if (current.size === 0) {
			taskMetadataListenersByTaskId.delete(taskId);
		}
	};
}

function areGitSummariesEqual(a: RuntimeGitSyncSummary | null, b: RuntimeGitSyncSummary | null): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}
	return (
		a.currentBranch === b.currentBranch &&
		a.upstreamBranch === b.upstreamBranch &&
		a.changedFiles === b.changedFiles &&
		a.additions === b.additions &&
		a.deletions === b.deletions &&
		a.aheadCount === b.aheadCount &&
		a.behindCount === b.behindCount
	);
}

function areTaskWorkspaceInfosEqual(
	a: RuntimeTaskWorkspaceInfoResponse | null,
	b: RuntimeTaskWorkspaceInfoResponse | null,
): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}
	return (
		a.taskId === b.taskId &&
		a.path === b.path &&
		a.exists === b.exists &&
		a.baseRef === b.baseRef &&
		a.branch === b.branch &&
		a.isDetached === b.isDetached &&
		a.headCommit === b.headCommit
	);
}

function areTaskWorkspaceSnapshotsEqual(
	a: ReviewTaskWorkspaceSnapshot | null,
	b: ReviewTaskWorkspaceSnapshot | null,
): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}
	return (
		a.taskId === b.taskId &&
		a.path === b.path &&
		a.branch === b.branch &&
		a.isDetached === b.isDetached &&
		a.headCommit === b.headCommit &&
		a.changedFiles === b.changedFiles &&
		a.additions === b.additions &&
		a.deletions === b.deletions
	);
}

export function getHomeGitSummary(): RuntimeGitSyncSummary | null {
	return workspaceMetadataState.homeGitSummary;
}

export function setHomeGitSummary(summary: RuntimeGitSyncSummary | null): boolean {
	if (areGitSummariesEqual(workspaceMetadataState.homeGitSummary, summary)) {
		return false;
	}
	workspaceMetadataState.homeGitSummary = summary;
	emitHomeGitSummary();
	return true;
}

export function clearHomeGitSummary(): void {
	setHomeGitSummary(null);
}

export function getTaskWorkspaceInfo(
	taskId: string | null | undefined,
	baseRef?: string | null,
): RuntimeTaskWorkspaceInfoResponse | null {
	const normalizedTaskId = taskId?.trim();
	if (!normalizedTaskId) {
		return null;
	}
	const value = workspaceMetadataState.taskWorkspaceInfoByTaskId[normalizedTaskId] ?? null;
	if (!value) {
		return null;
	}
	if (baseRef && value.baseRef !== baseRef) {
		return null;
	}
	return value;
}

export function setTaskWorkspaceInfo(info: RuntimeTaskWorkspaceInfoResponse | null): boolean {
	if (!info) {
		return false;
	}
	const existing = workspaceMetadataState.taskWorkspaceInfoByTaskId[info.taskId] ?? null;
	if (areTaskWorkspaceInfosEqual(existing, info)) {
		return false;
	}
	workspaceMetadataState.taskWorkspaceInfoByTaskId = {
		...workspaceMetadataState.taskWorkspaceInfoByTaskId,
		[info.taskId]: info,
	};
	emitTaskMetadata(info.taskId);
	return true;
}

export function clearTaskWorkspaceInfo(taskId: string | null | undefined): boolean {
	const normalizedTaskId = taskId?.trim();
	if (!normalizedTaskId || !(normalizedTaskId in workspaceMetadataState.taskWorkspaceInfoByTaskId)) {
		return false;
	}
	const { [normalizedTaskId]: _removed, ...rest } = workspaceMetadataState.taskWorkspaceInfoByTaskId;
	workspaceMetadataState.taskWorkspaceInfoByTaskId = rest;
	emitTaskMetadata(normalizedTaskId);
	return true;
}

export function getTaskWorkspaceSnapshot(taskId: string | null | undefined): ReviewTaskWorkspaceSnapshot | null {
	const normalizedTaskId = taskId?.trim();
	if (!normalizedTaskId) {
		return null;
	}
	return workspaceMetadataState.taskWorkspaceSnapshotByTaskId[normalizedTaskId] ?? null;
}

export function setTaskWorkspaceSnapshot(snapshot: ReviewTaskWorkspaceSnapshot | null): boolean {
	if (!snapshot) {
		return false;
	}
	const existing = workspaceMetadataState.taskWorkspaceSnapshotByTaskId[snapshot.taskId] ?? null;
	if (areTaskWorkspaceSnapshotsEqual(existing, snapshot)) {
		return false;
	}
	workspaceMetadataState.taskWorkspaceSnapshotByTaskId = {
		...workspaceMetadataState.taskWorkspaceSnapshotByTaskId,
		[snapshot.taskId]: snapshot,
	};
	emitTaskMetadata(snapshot.taskId);
	return true;
}

export function clearTaskWorkspaceSnapshot(taskId: string | null | undefined): boolean {
	const normalizedTaskId = taskId?.trim();
	if (!normalizedTaskId || !(normalizedTaskId in workspaceMetadataState.taskWorkspaceSnapshotByTaskId)) {
		return false;
	}
	const { [normalizedTaskId]: _removed, ...rest } = workspaceMetadataState.taskWorkspaceSnapshotByTaskId;
	workspaceMetadataState.taskWorkspaceSnapshotByTaskId = rest;
	emitTaskMetadata(normalizedTaskId);
	return true;
}

export function clearInactiveTaskWorkspaceSnapshots(activeTaskIds: Set<string>): void {
	let changed = false;
	const nextSnapshots: Record<string, ReviewTaskWorkspaceSnapshot | null> = {};
	for (const [taskId, snapshot] of Object.entries(workspaceMetadataState.taskWorkspaceSnapshotByTaskId)) {
		if (!activeTaskIds.has(taskId)) {
			changed = true;
			continue;
		}
		nextSnapshots[taskId] = snapshot;
	}
	if (!changed) {
		return;
	}
	workspaceMetadataState.taskWorkspaceSnapshotByTaskId = nextSnapshots;
	for (const taskId of taskMetadataListenersByTaskId.keys()) {
		if (!activeTaskIds.has(taskId)) {
			emitTaskMetadata(taskId);
		}
	}
}

export function resetWorkspaceMetadataStore(): void {
	const taskIds = new Set([
		...Object.keys(workspaceMetadataState.taskWorkspaceInfoByTaskId),
		...Object.keys(workspaceMetadataState.taskWorkspaceSnapshotByTaskId),
	]);
	workspaceMetadataState.homeGitSummary = null;
	workspaceMetadataState.taskWorkspaceInfoByTaskId = {};
	workspaceMetadataState.taskWorkspaceSnapshotByTaskId = {};
	emitHomeGitSummary();
	for (const taskId of taskIds) {
		emitTaskMetadata(taskId);
	}
}

export function subscribeToAnyTaskMetadata(listener: TaskMetadataListener): () => void {
	anyTaskMetadataListeners.add(listener);
	return () => {
		anyTaskMetadataListeners.delete(listener);
	};
}

export function useHomeGitSummaryValue(): RuntimeGitSyncSummary | null {
	return useSyncExternalStore(
		(listener) => {
			homeGitSummaryListeners.add(listener);
			return () => {
				homeGitSummaryListeners.delete(listener);
			};
		},
		() => workspaceMetadataState.homeGitSummary,
		() => null,
	);
}

export function useTaskWorkspaceInfoValue(
	taskId: string | null | undefined,
	baseRef?: string | null,
): RuntimeTaskWorkspaceInfoResponse | null {
	const normalizedTaskId = taskId?.trim() ?? "";
	return useSyncExternalStore(
		(listener) => {
			if (!normalizedTaskId) {
				return () => {};
			}
			return subscribeToTaskId(normalizedTaskId, listener);
		},
		() => getTaskWorkspaceInfo(normalizedTaskId, baseRef),
		() => null,
	);
}

export function useTaskWorkspaceSnapshotValue(taskId: string | null | undefined): ReviewTaskWorkspaceSnapshot | null {
	const normalizedTaskId = taskId?.trim() ?? "";
	return useSyncExternalStore(
		(listener) => {
			if (!normalizedTaskId) {
				return () => {};
			}
			return subscribeToTaskId(normalizedTaskId, listener);
		},
		() => getTaskWorkspaceSnapshot(normalizedTaskId),
		() => null,
	);
}
