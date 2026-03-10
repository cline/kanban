import { useCallback, useEffect, useRef, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { getTerminalGeometry, prepareWaitForTerminalGeometry } from "@/terminal/terminal-geometry-registry";
import type { SendTerminalInputOptions } from "@/terminal/terminal-input";
import type { RuntimeGitRepositoryInfo, RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardCard, CardSelection } from "@/types";

const HOME_TERMINAL_TASK_ID = "__home_terminal__";
const HOME_TERMINAL_ROWS = 16;
const DETAIL_TERMINAL_TASK_PREFIX = "__detail_terminal__:";
const APPROX_TERMINAL_CELL_WIDTH_PX = 8;
const MIN_TERMINAL_COLS = 40;

function estimateShellTerminalCols(): number {
	if (typeof window === "undefined") {
		return 120;
	}
	return Math.max(MIN_TERMINAL_COLS, Math.floor(Math.max(0, window.innerWidth - 96) / APPROX_TERMINAL_CELL_WIDTH_PX));
}

function getDetailTerminalTaskId(card: BoardCard): string {
	return `${DETAIL_TERMINAL_TASK_PREFIX}${card.id}`;
}

async function resolveShellTerminalGeometry(taskId: string): Promise<{ cols: number; rows: number }> {
	const existingGeometry = getTerminalGeometry(taskId);
	if (existingGeometry) {
		return existingGeometry;
	}
	await prepareWaitForTerminalGeometry(taskId)();
	return (
		getTerminalGeometry(taskId) ?? {
			cols: estimateShellTerminalCols(),
			rows: HOME_TERMINAL_ROWS,
		}
	);
}

interface StartDetailTerminalOptions {
	showLoading?: boolean;
}

interface UseTerminalPanelsInput {
	currentProjectId: string | null;
	selectedCard: CardSelection | null;
	workspaceGit: RuntimeGitRepositoryInfo | null;
	agentCommand: string | null;
	upsertSession: (summary: RuntimeTaskSessionSummary) => void;
	sendTaskSessionInput: (
		taskId: string,
		text: string,
		options?: SendTerminalInputOptions,
	) => Promise<{ ok: boolean; message?: string }>;
	onWorktreeError: (message: string | null) => void;
}

interface PrepareTerminalForShortcutInput {
	prepareWaitForTerminalConnectionReady: (taskId: string) => () => Promise<void>;
}

interface PrepareTerminalForShortcutResult {
	ok: boolean;
	targetTaskId?: string;
	message?: string;
}

export interface UseTerminalPanelsResult {
	homeTerminalTaskId: string;
	isHomeTerminalOpen: boolean;
	isHomeTerminalStarting: boolean;
	homeTerminalShellBinary: string | null;
	homeTerminalPaneHeight: number | undefined;
	isDetailTerminalOpen: boolean;
	detailTerminalTaskId: string | null;
	isDetailTerminalStarting: boolean;
	detailTerminalPaneHeight: number | undefined;
	isHomeTerminalExpanded: boolean;
	isDetailTerminalExpanded: boolean;
	setHomeTerminalPaneHeight: (height: number | undefined) => void;
	setDetailTerminalPaneHeight: (height: number | undefined) => void;
	handleToggleExpandHomeTerminal: () => void;
	handleToggleExpandDetailTerminal: () => void;
	handleToggleHomeTerminal: () => void;
	handleToggleDetailTerminal: () => void;
	handleSendAgentCommandToHomeTerminal: () => void;
	handleSendAgentCommandToDetailTerminal: () => void;
	prepareTerminalForShortcut: (
		input: PrepareTerminalForShortcutInput,
	) => Promise<PrepareTerminalForShortcutResult>;
	closeHomeTerminal: () => void;
	closeDetailTerminal: () => void;
	resetTerminalPanelsState: () => void;
}

export function useTerminalPanels({
	currentProjectId,
	selectedCard,
	workspaceGit,
	agentCommand,
	upsertSession,
	sendTaskSessionInput,
	onWorktreeError,
}: UseTerminalPanelsInput): UseTerminalPanelsResult {
	const homeTerminalProjectIdRef = useRef<string | null>(null);
	const detailTerminalSelectionKeyRef = useRef<string | null>(null);
	const [isHomeTerminalOpen, setIsHomeTerminalOpen] = useState(false);
	const [isHomeTerminalStarting, setIsHomeTerminalStarting] = useState(false);
	const [homeTerminalShellBinary, setHomeTerminalShellBinary] = useState<string | null>(null);
	const [homeTerminalPaneHeight, setHomeTerminalPaneHeight] = useState<number | undefined>(undefined);
	const [isDetailTerminalOpen, setIsDetailTerminalOpen] = useState(false);
	const [isDetailTerminalStarting, setIsDetailTerminalStarting] = useState(false);
	const [detailTerminalPaneHeight, setDetailTerminalPaneHeight] = useState<number | undefined>(undefined);
	const [isHomeTerminalExpanded, setIsHomeTerminalExpanded] = useState(false);
	const [isDetailTerminalExpanded, setIsDetailTerminalExpanded] = useState(false);
	const detailTerminalTaskId = selectedCard ? getDetailTerminalTaskId(selectedCard.card) : null;

	const closeHomeTerminal = useCallback(() => {
		setIsHomeTerminalOpen(false);
		setIsHomeTerminalExpanded(false);
		setHomeTerminalPaneHeight(undefined);
		homeTerminalProjectIdRef.current = null;
	}, []);

	const closeDetailTerminal = useCallback(() => {
		setIsDetailTerminalOpen(false);
		setIsDetailTerminalExpanded(false);
		setDetailTerminalPaneHeight(undefined);
		detailTerminalSelectionKeyRef.current = null;
	}, []);

	const handleToggleExpandHomeTerminal = useCallback(() => {
		setIsHomeTerminalExpanded((prev) => {
			setHomeTerminalPaneHeight(prev ? undefined : 99999);
			return !prev;
		});
	}, []);

	const handleToggleExpandDetailTerminal = useCallback(() => {
		setIsDetailTerminalExpanded((prev) => {
			setDetailTerminalPaneHeight(prev ? undefined : 99999);
			return !prev;
		});
	}, []);

	const startHomeTerminalSession = useCallback(async (): Promise<boolean> => {
		if (!currentProjectId) {
			return false;
		}
		setIsHomeTerminalStarting(true);
		try {
			const geometry = await resolveShellTerminalGeometry(HOME_TERMINAL_TASK_ID);
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			const payload = await trpcClient.runtime.startShellSession.mutate({
				taskId: HOME_TERMINAL_TASK_ID,
				cols: geometry.cols,
				rows: geometry.rows,
				baseRef: workspaceGit?.currentBranch ?? workspaceGit?.defaultBranch ?? "HEAD",
			});
			if (!payload.ok || !payload.summary) {
				throw new Error(payload.error ?? "Could not start terminal session.");
			}
			upsertSession(payload.summary);
			setHomeTerminalShellBinary(
				typeof payload.shellBinary === "string" && payload.shellBinary.trim() ? payload.shellBinary : null,
			);
			return true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			onWorktreeError(message);
			return false;
		} finally {
			setIsHomeTerminalStarting(false);
		}
	}, [
		currentProjectId,
		onWorktreeError,
		upsertSession,
		workspaceGit?.currentBranch,
		workspaceGit?.defaultBranch,
	]);

	const handleToggleHomeTerminal = useCallback(() => {
		if (isHomeTerminalOpen) {
			closeHomeTerminal();
			return;
		}
		if (!currentProjectId) {
			return;
		}
		homeTerminalProjectIdRef.current = currentProjectId;
		setIsHomeTerminalOpen(true);
		void startHomeTerminalSession();
	}, [closeHomeTerminal, currentProjectId, isHomeTerminalOpen, startHomeTerminalSession]);

	const startDetailTerminalForCard = useCallback(
		async (card: BoardCard, options?: StartDetailTerminalOptions): Promise<boolean> => {
			if (!currentProjectId) {
				return false;
			}
			const showLoading = options?.showLoading ?? false;
			if (showLoading) {
				setIsDetailTerminalStarting(true);
			}
			try {
				const targetTaskId = getDetailTerminalTaskId(card);
				const geometry = await resolveShellTerminalGeometry(targetTaskId);
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.runtime.startShellSession.mutate({
					taskId: targetTaskId,
					cols: geometry.cols,
					rows: geometry.rows,
					workspaceTaskId: card.id,
					baseRef: card.baseRef,
				});
				if (!payload.ok || !payload.summary) {
					throw new Error(payload.error ?? "Could not start detail terminal session.");
				}
				upsertSession(payload.summary);
				return true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				onWorktreeError(message);
				return false;
			} finally {
				if (showLoading) {
					setIsDetailTerminalStarting(false);
				}
			}
		},
		[currentProjectId, onWorktreeError, upsertSession],
	);

	const handleToggleDetailTerminal = useCallback(() => {
		if (!selectedCard) {
			return;
		}
		if (isDetailTerminalOpen) {
			closeDetailTerminal();
			return;
		}
		setIsDetailTerminalOpen(true);
		void (async () => {
			const selectionKey = `${selectedCard.card.id}:${selectedCard.card.baseRef}`;
			detailTerminalSelectionKeyRef.current = selectionKey;
			const started = await startDetailTerminalForCard(selectedCard.card, { showLoading: true });
			if (!started && detailTerminalSelectionKeyRef.current === selectionKey) {
				detailTerminalSelectionKeyRef.current = null;
			}
		})();
	}, [closeDetailTerminal, isDetailTerminalOpen, selectedCard, startDetailTerminalForCard]);

	useEffect(() => {
		if (!isDetailTerminalOpen || !selectedCard) {
			detailTerminalSelectionKeyRef.current = null;
			return;
		}
		const selectionKey = `${selectedCard.card.id}:${selectedCard.card.baseRef}`;
		if (detailTerminalSelectionKeyRef.current === selectionKey) {
			return;
		}
		detailTerminalSelectionKeyRef.current = selectionKey;
		void startDetailTerminalForCard(selectedCard.card);
	}, [isDetailTerminalOpen, selectedCard?.card.baseRef, selectedCard?.card.id, startDetailTerminalForCard]);

	useEffect(() => {
		if (!isHomeTerminalOpen) {
			homeTerminalProjectIdRef.current = null;
			return;
		}
		if (!currentProjectId || homeTerminalProjectIdRef.current === currentProjectId) {
			return;
		}
		homeTerminalProjectIdRef.current = currentProjectId;
		void (async () => {
			const started = await startHomeTerminalSession();
			if (!started) {
				closeHomeTerminal();
			}
		})();
	}, [closeHomeTerminal, currentProjectId, isHomeTerminalOpen, startHomeTerminalSession]);

	const handleSendAgentCommandToHomeTerminal = useCallback(() => {
		if (!agentCommand) {
			return;
		}
		void sendTaskSessionInput(HOME_TERMINAL_TASK_ID, agentCommand, { appendNewline: true });
	}, [agentCommand, sendTaskSessionInput]);

	const handleSendAgentCommandToDetailTerminal = useCallback(() => {
		if (!agentCommand || !selectedCard) {
			return;
		}
		const terminalTaskId = getDetailTerminalTaskId(selectedCard.card);
		void sendTaskSessionInput(terminalTaskId, agentCommand, { appendNewline: true });
	}, [agentCommand, selectedCard, sendTaskSessionInput]);

	const prepareTerminalForShortcut = useCallback(
		async ({ prepareWaitForTerminalConnectionReady }: PrepareTerminalForShortcutInput) => {
			let targetTaskId = HOME_TERMINAL_TASK_ID;
			let shouldWaitForConnection = false;
			let waitForTerminalConnectionReady: (() => Promise<void>) | null = null;
			const activeSelection = selectedCard;
			if (activeSelection) {
				targetTaskId = getDetailTerminalTaskId(activeSelection.card);
				const selectionKey = `${activeSelection.card.id}:${activeSelection.card.baseRef}`;
				const detailWasAlreadyOpenForSelection =
					isDetailTerminalOpen && detailTerminalSelectionKeyRef.current === selectionKey;
				shouldWaitForConnection = !detailWasAlreadyOpenForSelection;
				if (shouldWaitForConnection) {
					waitForTerminalConnectionReady = prepareWaitForTerminalConnectionReady(targetTaskId);
				}
				detailTerminalSelectionKeyRef.current = selectionKey;
				setIsDetailTerminalOpen(true);
				const started = await startDetailTerminalForCard(activeSelection.card, { showLoading: true });
				if (!started) {
					if (detailTerminalSelectionKeyRef.current === selectionKey) {
						detailTerminalSelectionKeyRef.current = null;
					}
					return {
						ok: false,
						message: "Could not open detail terminal.",
					} satisfies PrepareTerminalForShortcutResult;
				}
			} else {
				const homeWasAlreadyOpenForProject =
					isHomeTerminalOpen && homeTerminalProjectIdRef.current === currentProjectId;
				shouldWaitForConnection = !homeWasAlreadyOpenForProject;
				if (shouldWaitForConnection) {
					waitForTerminalConnectionReady = prepareWaitForTerminalConnectionReady(HOME_TERMINAL_TASK_ID);
				}
				homeTerminalProjectIdRef.current = currentProjectId;
				setIsHomeTerminalOpen(true);
				const started = await startHomeTerminalSession();
				if (!started) {
					closeHomeTerminal();
					return {
						ok: false,
						message: "Could not open terminal.",
					} satisfies PrepareTerminalForShortcutResult;
				}
			}

			if (shouldWaitForConnection && waitForTerminalConnectionReady) {
				await waitForTerminalConnectionReady();
			}

			return {
				ok: true,
				targetTaskId,
			} satisfies PrepareTerminalForShortcutResult;
		},
		[
			closeHomeTerminal,
			currentProjectId,
			isDetailTerminalOpen,
			isHomeTerminalOpen,
			selectedCard,
			startDetailTerminalForCard,
			startHomeTerminalSession,
		],
	);

	const resetTerminalPanelsState = useCallback(() => {
		closeHomeTerminal();
		setIsHomeTerminalStarting(false);
		setHomeTerminalShellBinary(null);
		closeDetailTerminal();
		setIsDetailTerminalStarting(false);
	}, [closeDetailTerminal, closeHomeTerminal]);

	return {
		homeTerminalTaskId: HOME_TERMINAL_TASK_ID,
		isHomeTerminalOpen,
		isHomeTerminalStarting,
		homeTerminalShellBinary,
		homeTerminalPaneHeight,
		isDetailTerminalOpen,
		detailTerminalTaskId,
		isDetailTerminalStarting,
		detailTerminalPaneHeight,
		isHomeTerminalExpanded,
		isDetailTerminalExpanded,
		setHomeTerminalPaneHeight,
		setDetailTerminalPaneHeight,
		handleToggleExpandHomeTerminal,
		handleToggleExpandDetailTerminal,
		handleToggleHomeTerminal,
		handleToggleDetailTerminal,
		handleSendAgentCommandToHomeTerminal,
		handleSendAgentCommandToDetailTerminal,
		prepareTerminalForShortcut,
		closeHomeTerminal,
		closeDetailTerminal,
		resetTerminalPanelsState,
	};
}
