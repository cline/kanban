import { Classes, Colors, MenuItem, Spinner } from "@blueprintjs/core";
import { Omnibar } from "@blueprintjs/select";
import type { DropResult } from "@hello-pangea/dnd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";

import {
	buildProjectPathname,
	countTasksByColumn,
	createIdleTaskSession,
	filterTask,
	loadPersistedTaskStartInPlanMode,
	loadPersistedTaskWorkspaceMode,
	parseProjectIdFromPathname,
	persistTaskStartInPlanMode,
	persistTaskWorkspaceMode,
	renderTask,
	type SearchableTask,
} from "@/kanban/app/app-utils";
import { showAppToast } from "@/kanban/components/app-toaster";
import { CardDetailView } from "@/kanban/components/card-detail-view";
import { KanbanBoard } from "@/kanban/components/kanban-board";
import { ProjectNavigationPanel } from "@/kanban/components/project-navigation-panel";
import { RuntimeStatusBanners } from "@/kanban/components/runtime-status-banners";
import { RuntimeSettingsDialog } from "@/kanban/components/runtime-settings-dialog";
import { TaskInlineCreateCard, type TaskWorkspaceMode } from "@/kanban/components/task-inline-create-card";
import { TaskTrashWarningDialog } from "@/kanban/components/task-trash-warning-dialog";
import { TopBar } from "@/kanban/components/top-bar";
import { createInitialBoardData } from "@/kanban/data/board-data";
import { useRuntimeProjectConfig } from "@/kanban/runtime/use-runtime-project-config";
import { useRuntimeStateStream } from "@/kanban/runtime/use-runtime-state-stream";
import { workspaceFetch } from "@/kanban/runtime/workspace-fetch";
import {
	fetchWorkspaceState,
	saveWorkspaceState,
} from "@/kanban/runtime/workspace-state-query";
import { useWorkspacePersistence } from "@/kanban/runtime/use-workspace-persistence";
import {
	DISALLOWED_TASK_KICKOFF_SLASH_COMMANDS,
	splitPromptToTitleDescription,
} from "@/kanban/utils/task-prompt";
import type {
	RuntimeProjectAddResponse,
	RuntimeProjectDirectoryPickerResponse,
	RuntimeGitRepositoryInfo,
	RuntimeProjectRemoveResponse,
	RuntimeWorkspaceStateResponse,
	RuntimeShortcutRunResponse,
	RuntimeTaskSessionSummary,
	RuntimeTaskWorkspaceInfoResponse,
	RuntimeWorktreeDeleteResponse,
	RuntimeWorktreeEnsureResponse,
} from "@/kanban/runtime/types";
import {
	addTaskToColumn,
	applyDragResult,
	findCardSelection,
	getTaskColumnId,
	moveTaskToColumn,
	normalizeBoardData,
} from "@/kanban/state/board-state";
import type { BoardCard, BoardColumnId, BoardData } from "@/kanban/types";

interface PendingTrashWarningState {
	taskId: string;
	fileCount: number;
	taskTitle: string;
	workspaceInfo: RuntimeTaskWorkspaceInfoResponse | null;
}

export default function App(): ReactElement {
	const [board, setBoard] = useState<BoardData>(() => createInitialBoardData());
	const [sessions, setSessions] = useState<Record<string, RuntimeTaskSessionSummary>>({});
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [workspacePath, setWorkspacePath] = useState<string | null>(null);
	const [workspaceGit, setWorkspaceGit] = useState<RuntimeGitRepositoryInfo | null>(null);
	const [appliedWorkspaceProjectId, setAppliedWorkspaceProjectId] = useState<string | null>(null);
	const [workspaceRevision, setWorkspaceRevision] = useState<number | null>(null);
	const [workspaceHydrationNonce, setWorkspaceHydrationNonce] = useState(0);
	const workspaceVersionRef = useRef<{ projectId: string | null; revision: number | null }>({
		projectId: null,
		revision: null,
	});
	const workspaceRefreshRequestIdRef = useRef(0);
	const previousSessionsRef = useRef<Record<string, RuntimeTaskSessionSummary>>({});
	const [selectedTaskWorkspaceInfo, setSelectedTaskWorkspaceInfo] =
		useState<RuntimeTaskWorkspaceInfoResponse | null>(null);
	const [canPersistWorkspaceState, setCanPersistWorkspaceState] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
	const [isInlineTaskCreateOpen, setIsInlineTaskCreateOpen] = useState(false);
	const [newTaskPrompt, setNewTaskPrompt] = useState("");
	const [newTaskStartInPlanMode, setNewTaskStartInPlanMode] = useState<boolean>(() =>
		loadPersistedTaskStartInPlanMode(),
	);
	const [newTaskWorkspaceMode, setNewTaskWorkspaceMode] = useState<TaskWorkspaceMode>(() =>
		loadPersistedTaskWorkspaceMode(),
	);
	const [newTaskBranchRef, setNewTaskBranchRef] = useState("");
	const [worktreeError, setWorktreeError] = useState<string | null>(null);
	const [pendingTrashWarning, setPendingTrashWarning] = useState<PendingTrashWarningState | null>(null);
	const [runningShortcutId, setRunningShortcutId] = useState<string | null>(null);
	const [runtimeProjectConfigRefreshNonce, setRuntimeProjectConfigRefreshNonce] = useState(0);
	const [lastShortcutOutput, setLastShortcutOutput] = useState<{
		label: string;
		result: RuntimeShortcutRunResponse;
	} | null>(null);
	const [requestedProjectId, setRequestedProjectId] = useState<string | null>(() => {
		if (typeof window === "undefined") {
			return null;
		}
		return parseProjectIdFromPathname(window.location.pathname);
	});
	const [isWorkspaceStateRefreshing, setIsWorkspaceStateRefreshing] = useState(false);
	const [isDocumentVisible, setIsDocumentVisible] = useState<boolean>(() => {
		if (typeof document === "undefined") {
			return true;
		}
		return document.visibilityState === "visible";
	});
	const {
		currentProjectId,
		projects,
		workspaceState: streamedWorkspaceState,
		streamError,
	} = useRuntimeStateStream(requestedProjectId);
	const navigationCurrentProjectId = requestedProjectId ?? currentProjectId;
	const isProjectSwitching = requestedProjectId !== currentProjectId;
	const isInitialRuntimeLoad = currentProjectId === null && projects.length === 0 && !streamError;
	const isAwaitingWorkspaceSnapshot = currentProjectId !== null && streamedWorkspaceState === null;
	const isWorkspaceMetadataPending =
		currentProjectId !== null &&
		appliedWorkspaceProjectId !== currentProjectId;
	const navigationProjectPath = useMemo(() => {
		if (!navigationCurrentProjectId) {
			return null;
		}
		return projects.find((project) => project.id === navigationCurrentProjectId)?.path ?? null;
	}, [navigationCurrentProjectId, projects]);
	const shouldShowProjectLoadingState =
		selectedTaskId === null && (isProjectSwitching || isInitialRuntimeLoad || isAwaitingWorkspaceSnapshot);
	const shouldUseNavigationPath =
		isProjectSwitching || isAwaitingWorkspaceSnapshot || isWorkspaceMetadataPending;
	const { config: runtimeProjectConfig } = useRuntimeProjectConfig(
		currentProjectId,
		runtimeProjectConfigRefreshNonce,
	);
	// Project list counts are server-driven and can lag behind local board edits by a short
	// persistence/broadcast round-trip, so we optimistically overlay the active project's counts.
	const displayedProjects = useMemo(() => {
		if (!canPersistWorkspaceState || !currentProjectId) {
			return projects;
		}
		const localCounts = countTasksByColumn(board);
		return projects.map((project) =>
			project.id === currentProjectId
				? {
						...project,
						taskCounts: localCounts,
					}
				: project,
		);
	}, [board, canPersistWorkspaceState, currentProjectId, projects]);

	useEffect(() => {
		if (workspaceVersionRef.current.projectId !== currentProjectId) {
			return;
		}
		workspaceVersionRef.current = {
			projectId: currentProjectId,
			revision: workspaceRevision,
		};
	}, [currentProjectId, workspaceRevision]);

	const applyWorkspaceState = useCallback(
		(nextWorkspaceState: RuntimeWorkspaceStateResponse | null) => {
			if (!nextWorkspaceState) {
				setCanPersistWorkspaceState(false);
				setWorkspacePath(null);
				setWorkspaceGit(null);
				setAppliedWorkspaceProjectId(null);
				setBoard(createInitialBoardData());
				setSessions({});
				setWorkspaceRevision(null);
				workspaceVersionRef.current = {
					projectId: currentProjectId,
					revision: null,
				};
				return;
			}
			const currentVersion = workspaceVersionRef.current;
			const isSameProject = currentVersion.projectId === currentProjectId;
			const currentRevision = isSameProject ? currentVersion.revision : null;
			if (
				isSameProject &&
				currentRevision !== null &&
				nextWorkspaceState.revision < currentRevision
			) {
				return;
			}
			setWorkspacePath(nextWorkspaceState.repoPath);
			setWorkspaceGit(nextWorkspaceState.git);
			setSessions(nextWorkspaceState.sessions ?? {});
			const shouldHydrateBoard =
				!isSameProject ||
				currentRevision !== nextWorkspaceState.revision;
			if (shouldHydrateBoard) {
				const normalized = normalizeBoardData(nextWorkspaceState.board) ?? createInitialBoardData();
				setBoard(normalized);
				setWorkspaceHydrationNonce((current) => current + 1);
			}
			setWorkspaceRevision(nextWorkspaceState.revision);
			workspaceVersionRef.current = {
				projectId: currentProjectId,
				revision: nextWorkspaceState.revision,
			};
			setAppliedWorkspaceProjectId(currentProjectId);
			setCanPersistWorkspaceState(true);
		},
		[currentProjectId],
	);

	const upsertSession = useCallback((summary: RuntimeTaskSessionSummary) => {
		setSessions((current) => ({
			...current,
			[summary.taskId]: summary,
		}));
	}, []);

	const ensureTaskWorkspace = useCallback(async (task: BoardCard): Promise<{ ok: boolean; message?: string }> => {
		try {
			const response = await workspaceFetch("/api/workspace/worktree/ensure", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					taskId: task.id,
					baseRef: task.baseRef ?? null,
				}),
				workspaceId: currentProjectId,
			});
			const payload = (await response.json().catch(() => null)) as
				| RuntimeWorktreeEnsureResponse
				| { error?: string }
				| null;
			if (!response.ok || !payload || !("ok" in payload) || !payload.ok) {
				return {
					ok: false,
					message:
						(payload && "error" in payload && typeof payload.error === "string" && payload.error) ||
						`Worktree setup failed with ${response.status}.`,
				};
			}
			return { ok: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { ok: false, message };
		}
	}, [currentProjectId]);

	const startTaskSession = useCallback(async (task: BoardCard): Promise<{ ok: boolean; message?: string }> => {
		try {
			const kickoffPrompt = task.prompt.trim() || task.description.trim() || task.title;
			const response = await workspaceFetch("/api/runtime/task-session/start", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					taskId: task.id,
					prompt: kickoffPrompt,
					startInPlanMode: task.startInPlanMode,
					baseRef: task.baseRef ?? null,
				}),
				workspaceId: currentProjectId,
			});
			const payload = (await response.json().catch(() => null)) as
				| { ok?: boolean; error?: string; summary?: RuntimeTaskSessionSummary | null }
				| null;
			if (!response.ok || !payload || !payload.ok || !payload.summary) {
				return {
					ok: false,
					message: payload?.error ?? `Task session start failed with ${response.status}.`,
				};
			}
			upsertSession(payload.summary);
			return { ok: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { ok: false, message };
		}
	}, [currentProjectId, upsertSession]);

	const stopTaskSession = useCallback(async (taskId: string): Promise<void> => {
		try {
			await workspaceFetch("/api/runtime/task-session/stop", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ taskId }),
				workspaceId: currentProjectId,
			});
		} catch {
			// Ignore stop errors during cleanup.
		}
	}, [currentProjectId]);

	const cleanupTaskWorkspace = useCallback(async (taskId: string): Promise<RuntimeWorktreeDeleteResponse | null> => {
		try {
			const response = await workspaceFetch("/api/workspace/worktree/delete", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ taskId }),
				workspaceId: currentProjectId,
			});
			const payload = (await response.json().catch(() => null)) as
				| RuntimeWorktreeDeleteResponse
				| { error?: string }
				| null;
			if (!response.ok || !payload || !("ok" in payload) || !payload.ok) {
				const message =
					(payload && "error" in payload && typeof payload.error === "string" && payload.error) ||
					`Could not clean up task workspace (${response.status}).`;
				setWorktreeError(message);
				return null;
			}
			setWorktreeError(null);
			return payload;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setWorktreeError(message);
			return null;
		}
	}, [currentProjectId]);

	const fetchTaskWorkspaceInfo = useCallback(
		async (task: BoardCard): Promise<RuntimeTaskWorkspaceInfoResponse | null> => {
			try {
				const params = new URLSearchParams({
					taskId: task.id,
				});
				params.set("baseRef", task.baseRef ?? "");
				const response = await workspaceFetch(`/api/workspace/task-context?${params.toString()}`, {
					workspaceId: currentProjectId,
				});
				if (!response.ok) {
					const payload = (await response.json().catch(() => null)) as { error?: string } | null;
					throw new Error(payload?.error ?? `Task workspace request failed with ${response.status}`);
				}
				return (await response.json()) as RuntimeTaskWorkspaceInfoResponse;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setWorktreeError(message);
				return null;
			}
		},
		[currentProjectId],
	);

	const fetchTaskWorkingChangeCount = useCallback(async (task: BoardCard): Promise<number | null> => {
		try {
			const params = new URLSearchParams({
				taskId: task.id,
			});
			params.set("baseRef", task.baseRef ?? "");
			const response = await workspaceFetch(`/api/workspace/changes?${params.toString()}`, {
				workspaceId: currentProjectId,
			});
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as { error?: string } | null;
				throw new Error(payload?.error ?? `Workspace request failed with ${response.status}`);
			}
			const payload = (await response.json()) as { files?: unknown[] };
			return Array.isArray(payload.files) ? payload.files.length : 0;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setWorktreeError(message);
			return null;
		}
	}, [currentProjectId]);

	const selectedCard = useMemo(() => {
		if (!selectedTaskId) {
			return null;
		}
		return findCardSelection(board, selectedTaskId);
	}, [board, selectedTaskId]);

	const searchableTasks = useMemo((): SearchableTask[] => {
		return board.columns.flatMap((column) =>
			column.cards.map((card) => ({
				id: card.id,
				title: card.title,
				columnTitle: column.title,
			})),
		);
	}, [board.columns]);

	useEffect(() => {
		setBoard((currentBoard) => {
			let nextBoard = currentBoard;
			const previousSessions = previousSessionsRef.current;
			for (const summary of Object.values(sessions)) {
				const previous = previousSessions[summary.taskId];
				if (!previous || previous.updatedAt > summary.updatedAt) {
					continue;
				}
				const columnId = getTaskColumnId(nextBoard, summary.taskId);
				if (
					summary.state === "awaiting_review" &&
					previous.state !== "awaiting_review" &&
					columnId === "in_progress"
				) {
					const moved = moveTaskToColumn(nextBoard, summary.taskId, "review");
					if (moved.moved) {
						nextBoard = moved.board;
					}
					continue;
				}
				if (
					summary.state === "interrupted" &&
					previous.state !== "interrupted" &&
					columnId &&
					columnId !== "trash"
				) {
					const moved = moveTaskToColumn(nextBoard, summary.taskId, "trash");
					if (moved.moved) {
						nextBoard = moved.board;
					}
				}
			}
			return nextBoard;
		});
		previousSessionsRef.current = sessions;
	}, [sessions]);

	useEffect(() => {
		let cancelled = false;
		const loadSelectedTaskWorkspaceInfo = async () => {
			if (!selectedCard) {
				setSelectedTaskWorkspaceInfo(null);
				return;
			}
			const info = await fetchTaskWorkspaceInfo(selectedCard.card);
			if (!cancelled) {
				setSelectedTaskWorkspaceInfo(info);
			}
		};
		void loadSelectedTaskWorkspaceInfo();
		return () => {
			cancelled = true;
		};
	}, [fetchTaskWorkspaceInfo, selectedCard?.card.baseRef, selectedCard?.card.id]);

	const createTaskBranchOptions = useMemo(() => {
		if (!workspaceGit?.hasGit) {
			return [] as Array<{ value: string; label: string }>;
		}

		const options: Array<{ value: string; label: string }> = [];
		const seen = new Set<string>();
		const append = (value: string | null, labelSuffix?: string) => {
			if (!value || seen.has(value)) {
				return;
			}
			seen.add(value);
			options.push({
				value,
				label: labelSuffix ? `${value} ${labelSuffix}` : value,
			});
		};

		append(workspaceGit.currentBranch, "(current)");
		const mainCandidate = workspaceGit.branches.includes("main") ? "main" : workspaceGit.defaultBranch;
		append(mainCandidate, mainCandidate && mainCandidate !== workspaceGit.currentBranch ? "(default)" : undefined);
		for (const branch of workspaceGit.branches) {
			append(branch);
		}
		append(workspaceGit.defaultBranch, workspaceGit.defaultBranch ? "(default)" : undefined);

		return options;
	}, [workspaceGit]);

	const canUseWorktree = createTaskBranchOptions.length > 0;
	const defaultTaskBranchRef = useMemo(() => {
		if (!workspaceGit?.hasGit) {
			return "";
		}
		return workspaceGit.currentBranch ?? workspaceGit.defaultBranch ?? createTaskBranchOptions[0]?.value ?? "";
	}, [createTaskBranchOptions, workspaceGit]);

	const refreshWorkspaceState = useCallback(async () => {
		if (!currentProjectId) {
			return;
		}
		const requestId = workspaceRefreshRequestIdRef.current + 1;
		workspaceRefreshRequestIdRef.current = requestId;
		const requestedProjectId = currentProjectId;
		setIsWorkspaceStateRefreshing(true);
		try {
			const refreshed = await fetchWorkspaceState(requestedProjectId);
			if (
				workspaceRefreshRequestIdRef.current !== requestId ||
				workspaceVersionRef.current.projectId !== requestedProjectId
			) {
				return;
			}
			applyWorkspaceState(refreshed);
			setWorktreeError(null);
		} catch (error) {
			if (
				workspaceRefreshRequestIdRef.current !== requestId ||
				workspaceVersionRef.current.projectId !== requestedProjectId
			) {
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			setWorktreeError(message);
		} finally {
			if (workspaceRefreshRequestIdRef.current === requestId) {
				setIsWorkspaceStateRefreshing(false);
			}
		}
	}, [applyWorkspaceState, currentProjectId]);

	const persistWorkspaceStateAsync = useCallback(
		async (input: {
			workspaceId: string;
			payload: Parameters<typeof saveWorkspaceState>[1];
		}) => await saveWorkspaceState(input.workspaceId, input.payload),
		[],
	);
	const handleWorkspaceStateConflict = useCallback(() => {
		showAppToast(
			{
				intent: "warning",
				icon: "warning-sign",
				message: "Workspace changed elsewhere. Synced latest state. Retry your last edit if needed.",
				timeout: 5000,
			},
			"workspace-state-conflict",
		);
	}, []);

	useWorkspacePersistence({
		board,
		sessions,
		currentProjectId,
		workspaceRevision,
		hydrationNonce: workspaceHydrationNonce,
		canPersistWorkspaceState,
		isDocumentVisible,
		isWorkspaceStateRefreshing,
		persistWorkspaceState: persistWorkspaceStateAsync,
		refetchWorkspaceState: refreshWorkspaceState,
		onWorkspaceRevisionChange: setWorkspaceRevision,
		onWorkspaceStateConflict: handleWorkspaceStateConflict,
	});

	useEffect(() => {
		if (!streamedWorkspaceState) {
			return;
		}
		applyWorkspaceState(streamedWorkspaceState);
	}, [applyWorkspaceState, streamedWorkspaceState]);

	useEffect(() => {
		if (!streamError) {
			return;
		}
		setWorktreeError(streamError);
	}, [streamError]);

	useEffect(() => {
		if (workspaceVersionRef.current.projectId !== currentProjectId) {
			workspaceRefreshRequestIdRef.current += 1;
			setCanPersistWorkspaceState(false);
			setWorkspaceRevision(null);
			setIsWorkspaceStateRefreshing(false);
			setAppliedWorkspaceProjectId(null);
			workspaceVersionRef.current = {
				projectId: currentProjectId,
				revision: null,
			};
			previousSessionsRef.current = {};
		}
		setWorktreeError(null);
		setSelectedTaskId(null);
		setSelectedTaskWorkspaceInfo(null);
		setIsInlineTaskCreateOpen(false);
	}, [currentProjectId]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		if (!currentProjectId) {
			return;
		}
		const nextUrl = new URL(window.location.href);
		const nextPathname = buildProjectPathname(currentProjectId);
		if (nextUrl.pathname === nextPathname) {
			return;
		}
		window.history.replaceState({}, "", `${nextPathname}${nextUrl.search}${nextUrl.hash}`);
	}, [currentProjectId]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		const handlePopState = () => {
			const nextProjectId = parseProjectIdFromPathname(window.location.pathname);
			setRequestedProjectId(nextProjectId);
		};
		window.addEventListener("popstate", handlePopState);
		return () => {
			window.removeEventListener("popstate", handlePopState);
		};
	}, []);

	useEffect(() => {
		if (!requestedProjectId || !currentProjectId) {
			return;
		}
		const requestedStillExists = projects.some((project) => project.id === requestedProjectId);
		if (requestedStillExists) {
			return;
		}
		setRequestedProjectId(currentProjectId);
	}, [currentProjectId, projects, requestedProjectId]);

	useEffect(() => {
		if (typeof document === "undefined") {
			return;
		}
		const handleVisibilityChange = () => {
			const visible = document.visibilityState === "visible";
			setIsDocumentVisible(visible);
			if (visible) {
				void refreshWorkspaceState();
			}
		};
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [refreshWorkspaceState]);

	useEffect(() => {
		persistTaskWorkspaceMode(newTaskWorkspaceMode);
	}, [newTaskWorkspaceMode]);

	useEffect(() => {
		persistTaskStartInPlanMode(newTaskStartInPlanMode);
	}, [newTaskStartInPlanMode]);

	useEffect(() => {
		if (!canUseWorktree && newTaskWorkspaceMode === "worktree") {
			setNewTaskWorkspaceMode("local");
		}
	}, [canUseWorktree, newTaskWorkspaceMode]);

	useEffect(() => {
		if (!canUseWorktree) {
			setNewTaskBranchRef("");
			return;
		}
		const isCurrentValid = createTaskBranchOptions.some((option) => option.value === newTaskBranchRef);
		if (isCurrentValid) {
			return;
		}
		setNewTaskBranchRef(defaultTaskBranchRef);
	}, [canUseWorktree, createTaskBranchOptions, defaultTaskBranchRef, newTaskBranchRef]);

	useEffect(() => {
		if (!isInlineTaskCreateOpen) {
			return;
		}
		if (!canUseWorktree) {
			setNewTaskWorkspaceMode("local");
		}
		if (canUseWorktree && !newTaskBranchRef) {
			setNewTaskBranchRef(defaultTaskBranchRef);
		}
	}, [canUseWorktree, defaultTaskBranchRef, isInlineTaskCreateOpen, newTaskBranchRef]);

	useEffect(() => {
		if (selectedTaskId && !selectedCard) {
			setSelectedTaskId(null);
		}
	}, [selectedTaskId, selectedCard]);

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
		document.title = workspaceTitle ? `${workspaceTitle} | Kanbanana` : "Kanbanana";
	}, [workspaceTitle]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const isTypingTarget =
				target?.tagName === "INPUT" ||
				target?.tagName === "TEXTAREA" ||
				target?.isContentEditable;
			if (isTypingTarget) {
				return;
			}

			const key = event.key.toLowerCase();
			if ((event.metaKey || event.ctrlKey) && key === "k") {
				event.preventDefault();
				setIsCommandPaletteOpen((current) => !current);
				return;
			}

			if (!event.metaKey && !event.ctrlKey && key === "c") {
				event.preventDefault();
				setIsInlineTaskCreateOpen(true);
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	const handleBack = useCallback(() => {
		setSelectedTaskId(null);
	}, []);

	const handleSelectProject = useCallback((projectId: string) => {
		if (!projectId || projectId === currentProjectId) {
			return;
		}
		setCanPersistWorkspaceState(false);
		setRequestedProjectId(projectId);
		setSelectedTaskId(null);
		setIsInlineTaskCreateOpen(false);
	}, [currentProjectId]);

	const handleAddProject = useCallback(async () => {
		try {
			const pickResponse = await workspaceFetch("/api/projects/pick-directory", {
				method: "POST",
				workspaceId: currentProjectId,
			});
			const picked = (await pickResponse.json().catch(() => null)) as RuntimeProjectDirectoryPickerResponse | null;
			if (!pickResponse.ok || !picked?.ok || !picked.path) {
				if (picked?.error && picked.error !== "No directory was selected.") {
					throw new Error(picked.error);
				}
				return;
			}

			const addResponse = await workspaceFetch("/api/projects/add", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					path: picked.path,
				}),
				workspaceId: currentProjectId,
			});
			const added = (await addResponse.json().catch(() => null)) as RuntimeProjectAddResponse | null;
			if (!addResponse.ok || !added?.ok || !added.project) {
				throw new Error(added?.error ?? `Could not add project (${addResponse.status}).`);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setWorktreeError(message);
		}
	}, [currentProjectId]);

	const handleRemoveProject = useCallback(
		async (projectId: string) => {
			try {
				const response = await workspaceFetch("/api/projects/remove", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ projectId }),
					workspaceId: currentProjectId,
				});
				const payload = (await response.json().catch(() => null)) as RuntimeProjectRemoveResponse | null;
				if (!response.ok || !payload?.ok) {
					throw new Error(payload?.error ?? `Could not remove project (${response.status}).`);
				}
				if (currentProjectId === projectId) {
					setCanPersistWorkspaceState(false);
					setRequestedProjectId(null);
					setSelectedTaskId(null);
					setIsInlineTaskCreateOpen(false);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setWorktreeError(message);
			}
		},
		[currentProjectId],
	);

	const handleOpenCreateTask = useCallback(() => {
		setIsInlineTaskCreateOpen(true);
	}, []);

	const handleCancelCreateTask = useCallback(() => {
		setIsInlineTaskCreateOpen(false);
		setNewTaskPrompt("");
		if (canUseWorktree) {
			setNewTaskBranchRef(defaultTaskBranchRef);
		}
	}, [canUseWorktree, defaultTaskBranchRef]);

	const handleCreateTask = useCallback(() => {
		const prompt = newTaskPrompt.trim();
		if (!prompt) {
			return;
		}
		if (newTaskWorkspaceMode === "worktree" && (!canUseWorktree || !(newTaskBranchRef || defaultTaskBranchRef))) {
			return;
		}
		const parsedPrompt = splitPromptToTitleDescription(prompt);
		const title = parsedPrompt.title.trim();
		if (!title) {
			return;
		}
		const baseRef =
			newTaskWorkspaceMode === "worktree" && canUseWorktree
				? (newTaskBranchRef || defaultTaskBranchRef || null)
				: null;
		setBoard((currentBoard) =>
			addTaskToColumn(currentBoard, "backlog", {
				title,
				description: parsedPrompt.description,
				prompt,
				startInPlanMode: newTaskStartInPlanMode,
				baseRef,
			}),
		);
		setNewTaskPrompt("");
		if (canUseWorktree) {
			setNewTaskBranchRef(defaultTaskBranchRef);
		}
		setIsInlineTaskCreateOpen(false);
		setWorktreeError(null);
	}, [
		canUseWorktree,
		defaultTaskBranchRef,
		newTaskBranchRef,
		newTaskPrompt,
		newTaskStartInPlanMode,
		newTaskWorkspaceMode,
	]);

	const performMoveTaskToTrash = useCallback(
		async (task: BoardCard): Promise<void> => {
			await stopTaskSession(task.id);
			setBoard((currentBoard) => {
				const moved = moveTaskToColumn(currentBoard, task.id, "trash");
				return moved.moved ? moved.board : currentBoard;
			});
			await cleanupTaskWorkspace(task.id);
			if (selectedTaskId === task.id) {
				const info = await fetchTaskWorkspaceInfo(task);
				setSelectedTaskWorkspaceInfo(info);
			}
		},
		[cleanupTaskWorkspace, fetchTaskWorkspaceInfo, selectedTaskId, stopTaskSession],
	);

	const requestMoveTaskToTrash = useCallback(
		async (taskId: string, _fromColumnId: BoardColumnId): Promise<void> => {
			const selection = findCardSelection(board, taskId);
			if (!selection) {
				return;
			}

			const changeCount = await fetchTaskWorkingChangeCount(selection.card);
			if (changeCount == null) {
				return;
			}

			if (changeCount > 0) {
				const workspaceInfo =
					selectedTaskWorkspaceInfo && selectedTaskWorkspaceInfo.taskId === selection.card.id
						? selectedTaskWorkspaceInfo
						: await fetchTaskWorkspaceInfo(selection.card);
				setPendingTrashWarning({
					taskId,
					fileCount: changeCount,
					taskTitle: selection.card.title,
					workspaceInfo,
				});
				return;
			}

			await performMoveTaskToTrash(selection.card);
		},
		[board, fetchTaskWorkingChangeCount, fetchTaskWorkspaceInfo, performMoveTaskToTrash, selectedTaskWorkspaceInfo],
	);

	const handleRunShortcut = useCallback(
		async (shortcutId: string) => {
			const shortcut = runtimeProjectConfig?.shortcuts.find((item) => item.id === shortcutId);
			if (!shortcut) {
				return;
			}

			setRunningShortcutId(shortcutId);
			try {
				const response = await workspaceFetch("/api/runtime/shortcut/run", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						command: shortcut.command,
					}),
					workspaceId: currentProjectId,
				});
				if (!response.ok) {
					const payload = (await response.json().catch(() => null)) as { error?: string } | null;
					throw new Error(payload?.error ?? `Shortcut run failed with ${response.status}`);
				}
				const result = (await response.json()) as RuntimeShortcutRunResponse;
				setLastShortcutOutput({
					label: shortcut.label,
					result,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setLastShortcutOutput({
					label: shortcut.label,
					result: {
						exitCode: 1,
						stdout: "",
						stderr: message,
						combinedOutput: message,
						durationMs: 0,
					},
				});
			} finally {
				setRunningShortcutId(null);
			}
		},
		[currentProjectId, runtimeProjectConfig?.shortcuts],
	);

	const handleDragEnd = useCallback(
		(result: DropResult, options?: { selectDroppedTask?: boolean }) => {
			if (options?.selectDroppedTask && result.type === "CARD" && result.destination) {
				setSelectedTaskId(result.draggableId);
			}

			const applied = applyDragResult(board, result);

			const moveEvent = applied.moveEvent;
			if (!moveEvent) {
				setBoard(applied.board);
				return;
			}

			if (moveEvent.toColumnId === "trash") {
				void requestMoveTaskToTrash(moveEvent.taskId, moveEvent.fromColumnId);
				return;
			}

			setBoard(applied.board);

			if (moveEvent.toColumnId === "in_progress") {
				const movedSelection = findCardSelection(applied.board, moveEvent.taskId);
				if (movedSelection) {
					void (async () => {
						const ensured = await ensureTaskWorkspace(movedSelection.card);
						if (!ensured.ok) {
							setWorktreeError(ensured.message ?? "Could not set up task workspace.");
							setBoard((currentBoard) => {
								const currentColumnId = getTaskColumnId(currentBoard, moveEvent.taskId);
								if (currentColumnId !== "in_progress") {
									return currentBoard;
								}
								const reverted = moveTaskToColumn(currentBoard, moveEvent.taskId, moveEvent.fromColumnId);
								return reverted.moved ? reverted.board : currentBoard;
							});
							return;
						}
						const started = await startTaskSession(movedSelection.card);
						if (!started.ok) {
							setWorktreeError(started.message ?? "Could not start task session.");
							setBoard((currentBoard) => {
								const currentColumnId = getTaskColumnId(currentBoard, moveEvent.taskId);
								if (currentColumnId !== "in_progress") {
									return currentBoard;
								}
								const reverted = moveTaskToColumn(currentBoard, moveEvent.taskId, moveEvent.fromColumnId);
								return reverted.moved ? reverted.board : currentBoard;
							});
							return;
						}
						setWorktreeError(null);
					})();
				}
			}
		},
		[board, ensureTaskWorkspace, requestMoveTaskToTrash, startTaskSession],
	);

	const handleDetailTaskDragEnd = useCallback(
		(result: DropResult) => {
			handleDragEnd(result, { selectDroppedTask: true });
		},
		[handleDragEnd],
	);

	const handleCardSelect = useCallback((taskId: string) => {
		setSelectedTaskId(taskId);
	}, []);

	const handleMoveToTrash = useCallback(() => {
		if (!selectedCard) {
			return;
		}
		void requestMoveTaskToTrash(selectedCard.card.id, selectedCard.column.id);
	}, [requestMoveTaskToTrash, selectedCard]);

	const detailSession = selectedCard ? sessions[selectedCard.card.id] ?? createIdleTaskSession(selectedCard.card.id) : null;
	const runtimeHint = useMemo(() => {
		if (shouldUseNavigationPath || !runtimeProjectConfig) {
			return undefined;
		}
		if (runtimeProjectConfig?.effectiveCommand) {
			return undefined;
		}
		const detected = runtimeProjectConfig?.detectedCommands?.join(", ");
		if (detected) {
			return `No agent configured (${detected})`;
		}
		return "No agent configured";
	}, [runtimeProjectConfig, shouldUseNavigationPath]);
	const repoHint = useMemo(() => {
		if (shouldUseNavigationPath) {
			return undefined;
		}
		if (!workspaceGit || workspaceGit.hasGit) {
			return undefined;
		}
		return "No git detected, worktree isolation disabled";
	}, [shouldUseNavigationPath, workspaceGit]);
	const activeWorkspacePath =
		selectedCard
			? selectedTaskWorkspaceInfo?.path ?? workspacePath ?? undefined
			: shouldUseNavigationPath
				? navigationProjectPath ?? undefined
				: workspacePath ?? undefined;
	const activeWorkspaceHint = useMemo(() => {
		if (!selectedCard || !selectedTaskWorkspaceInfo) {
			return undefined;
		}
		if (selectedTaskWorkspaceInfo.mode === "local") {
			if (!selectedTaskWorkspaceInfo.hasGit) {
				return "Local workspace (no git)";
			}
			if (selectedTaskWorkspaceInfo.isDetached) {
				return `Local detached HEAD (${selectedTaskWorkspaceInfo.headCommit?.slice(0, 8) ?? "unknown"})`;
			}
			if (selectedTaskWorkspaceInfo.branch) {
				return `Local branch: ${selectedTaskWorkspaceInfo.branch}`;
			}
			return "Local workspace";
		}
		if (selectedTaskWorkspaceInfo.deleted) {
			return selectedCard.column.id === "trash" ? "Task worktree deleted" : "Task worktree not created yet";
		}
		if (selectedTaskWorkspaceInfo.isDetached) {
			return `Worktree detached HEAD (${selectedTaskWorkspaceInfo.headCommit?.slice(0, 8) ?? "unknown"})`;
		}
		if (selectedTaskWorkspaceInfo.branch) {
			return `Worktree branch: ${selectedTaskWorkspaceInfo.branch}`;
		}
		return `Worktree base: ${selectedTaskWorkspaceInfo.baseRef ?? "unknown"}`;
	}, [selectedCard, selectedTaskWorkspaceInfo]);
	const trashWarningGuidance = useMemo(() => {
		if (!pendingTrashWarning) {
			return [] as string[];
		}
		const info = pendingTrashWarning.workspaceInfo;
		if (!info) {
			return ["Save your changes before trashing this task."];
		}
		if (info.mode === "local") {
			const branch = info.branch ?? "your current branch";
			return [
				`Commit your changes on ${branch}, then open a PR or keep the branch for later.`,
				"Or cherry-pick the commit into your target branch.",
			];
		}
		if (info.isDetached) {
			return [
				"Create a branch inside this worktree, commit, then open a PR from that branch.",
				"Or commit and cherry-pick the commit onto your target branch (for example main).",
			];
		}
		const branch = info.branch ?? info.baseRef ?? "a branch";
		return [
			`Commit your changes in the worktree branch (${branch}), then open a PR or cherry-pick as needed.`,
			"After preserving the work, you can safely move this task to Trash.",
		];
	}, [pendingTrashWarning]);
	const inlineTaskCreator = isInlineTaskCreateOpen ? (
		<TaskInlineCreateCard
			prompt={newTaskPrompt}
			onPromptChange={setNewTaskPrompt}
			onCreate={handleCreateTask}
			onCancel={handleCancelCreateTask}
			startInPlanMode={newTaskStartInPlanMode}
			onStartInPlanModeChange={setNewTaskStartInPlanMode}
			workspaceMode={newTaskWorkspaceMode}
			onWorkspaceModeChange={setNewTaskWorkspaceMode}
			workspaceId={currentProjectId}
			workspaceCurrentBranch={workspaceGit?.currentBranch ?? null}
			canUseWorktree={canUseWorktree}
			branchRef={newTaskBranchRef}
			branchOptions={createTaskBranchOptions}
			onBranchRefChange={setNewTaskBranchRef}
			disallowedSlashCommands={[...DISALLOWED_TASK_KICKOFF_SLASH_COMMANDS]}
		/>
	) : undefined;

	return (
		<div className={Classes.DARK} style={{ display: "flex", flexDirection: "row", height: "100svh", minWidth: 0, overflow: "hidden" }}>
				{!selectedCard ? (
					<ProjectNavigationPanel
						projects={displayedProjects}
						currentProjectId={navigationCurrentProjectId}
						onSelectProject={(projectId) => {
							void handleSelectProject(projectId);
						}}
					onRemoveProject={(projectId) => {
						void handleRemoveProject(projectId);
					}}
					onAddProject={() => {
						void handleAddProject();
					}}
				/>
			) : null}
			<div style={{ display: "flex", flexDirection: "column", flex: "1 1 0", minWidth: 0, overflow: "hidden" }}>
				<TopBar
					onBack={selectedCard ? handleBack : undefined}
					workspacePath={activeWorkspacePath}
					workspaceHint={activeWorkspaceHint}
					repoHint={repoHint}
					runtimeHint={runtimeHint}
					onOpenSettings={() => setIsSettingsOpen(true)}
					shortcuts={runtimeProjectConfig?.shortcuts ?? []}
					runningShortcutId={runningShortcutId}
					onRunShortcut={handleRunShortcut}
				/>
					<RuntimeStatusBanners
						worktreeError={worktreeError}
						onDismissWorktreeError={() => setWorktreeError(null)}
						shortcutOutput={lastShortcutOutput}
						onClearShortcutOutput={() => setLastShortcutOutput(null)}
					/>
					<div className={selectedCard ? "kb-hidden" : "kb-home-layout"}>
						{shouldShowProjectLoadingState ? (
							<div
								style={{
									display: "flex",
									flex: "1 1 0",
									minHeight: 0,
									alignItems: "center",
									justifyContent: "center",
									background: Colors.DARK_GRAY1,
								}}
							>
								<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
									<Spinner size={30} />
									<div className={Classes.TEXT_MUTED}>
										{isProjectSwitching ? "Loading project..." : "Connecting..."}
									</div>
								</div>
							</div>
						) : (
							<KanbanBoard
								data={board}
								taskSessions={sessions}
								onCardSelect={handleCardSelect}
								onCreateTask={handleOpenCreateTask}
								inlineTaskCreator={inlineTaskCreator}
								onDragEnd={handleDragEnd}
							/>
						)}
					</div>
				{selectedCard && detailSession ? (
					<CardDetailView
						selection={selectedCard}
						currentProjectId={currentProjectId}
						sessionSummary={detailSession}
						taskSessions={sessions}
						onSessionSummary={upsertSession}
						onBack={handleBack}
						onCardSelect={handleCardSelect}
						onTaskDragEnd={handleDetailTaskDragEnd}
						onCreateTask={handleOpenCreateTask}
						inlineTaskCreator={inlineTaskCreator}
						onMoveToTrash={handleMoveToTrash}
					/>
				) : null}
			</div>
				<RuntimeSettingsDialog
					open={isSettingsOpen}
					workspaceId={currentProjectId}
					onOpenChange={setIsSettingsOpen}
					onSaved={() => {
						setRuntimeProjectConfigRefreshNonce((current) => current + 1);
					}}
				/>
			<Omnibar<SearchableTask>
				isOpen={isCommandPaletteOpen}
				onClose={() => setIsCommandPaletteOpen(false)}
				items={searchableTasks}
				itemPredicate={filterTask}
				itemRenderer={renderTask}
				onItemSelect={(task) => {
					setSelectedTaskId(task.id);
					setIsCommandPaletteOpen(false);
				}}
				noResults={<MenuItem disabled text="No tasks found." roleStructure="listoption" />}
				resetOnSelect
			/>
			<TaskTrashWarningDialog
				open={pendingTrashWarning !== null}
				warning={
					pendingTrashWarning
						? {
								taskTitle: pendingTrashWarning.taskTitle,
								fileCount: pendingTrashWarning.fileCount,
								workspacePath: pendingTrashWarning.workspaceInfo?.path ?? null,
							}
						: null
				}
				guidance={trashWarningGuidance}
				onCancel={() => setPendingTrashWarning(null)}
				onConfirm={() => {
					if (!pendingTrashWarning) {
						return;
					}
					const selection = findCardSelection(board, pendingTrashWarning.taskId);
					setPendingTrashWarning(null);
					if (!selection) {
						return;
					}
					void performMoveTaskToTrash(selection.card);
				}}
			/>
		</div>
	);
}
