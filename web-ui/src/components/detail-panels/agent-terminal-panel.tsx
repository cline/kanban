import "@xterm/xterm/css/xterm.css";

import { Command, Maximize2, MessageSquare, Minimize2, X } from "lucide-react";
import type { MutableRefObject, ReactElement } from "react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { useTaskWorkspaceSnapshotValue } from "@/stores/workspace-metadata-store";
import { usePersistentTerminalSession } from "@/terminal/use-persistent-terminal-session";

const isMacPlatform =
	typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

interface AgentTerminalSessionControls {
	clearTerminal: () => void;
	containerRef: MutableRefObject<HTMLDivElement | null>;
	isStopping: boolean;
	lastError: string | null;
	stopTerminal: () => Promise<void>;
}

export interface AgentTerminalPanelProps {
	taskId: string;
	workspaceId: string | null;
	terminalEnabled?: boolean;
	summary: RuntimeTaskSessionSummary | null;
	onSummary?: (summary: RuntimeTaskSessionSummary) => void;
	onCommit?: () => void;
	onOpenPr?: () => void;
	isCommitLoading?: boolean;
	isOpenPrLoading?: boolean;
	taskColumnId?: string;
	onMoveToTrash?: () => void;
	isMoveToTrashLoading?: boolean;
	onCancelAutomaticAction?: () => void;
	cancelAutomaticActionLabel?: string | null;
	showMoveToTrash?: boolean;
	showSessionToolbar?: boolean;
	onClose?: () => void;
	autoFocus?: boolean;
	minimalHeaderTitle?: string;
	minimalHeaderSubtitle?: string | null;
	panelBackgroundColor?: string;
	terminalBackgroundColor?: string;
	cursorColor?: string;
	showRightBorder?: boolean;
	isVisible?: boolean;
	onConnectionReady?: (taskId: string) => void;
	agentCommand?: string | null;
	onSendAgentCommand?: () => void;
	isExpanded?: boolean;
	onToggleExpand?: () => void;
}

function describeState(summary: RuntimeTaskSessionSummary | null): string {
	if (!summary) {
		return "No session yet";
	}
	if (summary.state === "running") {
		return "Running";
	}
	if (summary.state === "awaiting_review") {
		return "Ready for review";
	}
	if (summary.state === "interrupted") {
		return "Interrupted";
	}
	if (summary.state === "failed") {
		return "Failed";
	}
	return "Idle";
}

type StatusTagStyle = "neutral" | "success" | "warning" | "danger";

function getStateTagStyle(summary: RuntimeTaskSessionSummary | null): StatusTagStyle {
	if (!summary) {
		return "neutral";
	}
	if (summary.state === "running") {
		return "success";
	}
	if (summary.state === "awaiting_review") {
		return "warning";
	}
	if (summary.state === "interrupted" || summary.state === "failed") {
		return "danger";
	}
	return "neutral";
}

const statusTagColors: Record<StatusTagStyle, string> = {
	neutral: "bg-surface-3 text-text-secondary",
	success: "bg-status-green/15 text-status-green",
	warning: "bg-status-orange/15 text-status-orange",
	danger: "bg-status-red/15 text-status-red",
};

function AgentTerminalReviewActions({
	taskId,
	taskColumnId,
	onCommit,
	onOpenPr,
	isCommitLoading,
	isOpenPrLoading,
}: {
	taskId: string;
	taskColumnId: string;
	onCommit?: () => void;
	onOpenPr?: () => void;
	isCommitLoading: boolean;
	isOpenPrLoading: boolean;
}): ReactElement | null {
	const reviewWorkspaceSnapshot = useTaskWorkspaceSnapshotValue(taskId);
	const showReviewGitActions = taskColumnId === "review" && (reviewWorkspaceSnapshot?.changedFiles ?? 0) > 0;

	if (!showReviewGitActions) {
		return null;
	}

	return (
		<div style={{ display: "flex", gap: 6 }}>
			<Button
				variant="primary"
				size="sm"
				style={{ flex: "1 1 0" }}
				disabled={isCommitLoading || isOpenPrLoading}
				onClick={onCommit}
			>
				{isCommitLoading ? "..." : "Commit"}
			</Button>
			<Button
				variant="primary"
				size="sm"
				style={{ flex: "1 1 0" }}
				disabled={isCommitLoading || isOpenPrLoading}
				onClick={onOpenPr}
			>
				{isOpenPrLoading ? "..." : "Open PR"}
			</Button>
		</div>
	);
}

function AgentTerminalPanelLayout({
	taskId,
	summary,
	onSummary: _onSummary,
	onCommit,
	onOpenPr,
	isCommitLoading = false,
	isOpenPrLoading = false,
	taskColumnId = "in_progress",
	onMoveToTrash,
	isMoveToTrashLoading = false,
	onCancelAutomaticAction,
	cancelAutomaticActionLabel,
	showMoveToTrash,
	showSessionToolbar = true,
	onClose,
	autoFocus: _autoFocus = false,
	minimalHeaderTitle = "Terminal",
	minimalHeaderSubtitle = null,
	panelBackgroundColor = "var(--color-surface-0)",
	terminalBackgroundColor = "var(--color-surface-0)",
	cursorColor: _cursorColor = "var(--color-text-primary)",
	showRightBorder = true,
	isVisible: _isVisible = true,
	onConnectionReady: _onConnectionReady,
	agentCommand,
	onSendAgentCommand,
	isExpanded = false,
	onToggleExpand,
	sessionControls,
}: AgentTerminalPanelProps & { sessionControls: AgentTerminalSessionControls }): ReactElement {
	const { containerRef, lastError, isStopping, clearTerminal, stopTerminal } = sessionControls;
	const canStop = summary?.state === "running" || summary?.state === "awaiting_review";
	const statusLabel = useMemo(() => describeState(summary), [summary]);
	const statusTagStyle = useMemo(() => getStateTagStyle(summary), [summary]);
	const agentLabel = useMemo(() => {
		const normalizedCommand = agentCommand?.trim();
		if (!normalizedCommand) {
			return null;
		}
		return normalizedCommand.split(/\s+/)[0] ?? null;
	}, [agentCommand]);
	const cancelAutomaticActionButtonLabel = useMemo(() => {
		if (!cancelAutomaticActionLabel) {
			return null;
		}
		return cancelAutomaticActionLabel.replace(/\b\w/g, (character) => character.toUpperCase());
	}, [cancelAutomaticActionLabel]);

	return (
		<div
			style={{
				display: "flex",
				flex: "1 1 0",
				flexDirection: "column",
				minWidth: 0,
				minHeight: 0,
				background: panelBackgroundColor,
				borderRight: showRightBorder ? "1px solid var(--color-divider)" : undefined,
			}}
		>
			{showSessionToolbar ? (
				<>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							gap: 8,
							padding: "8px 12px",
						}}
					>
						<div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
							<span
								className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${statusTagColors[statusTagStyle]}`}
							>
								{statusLabel}
							</span>
						</div>
						<div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
							<Button variant="default" size="sm" onClick={clearTerminal}>
								Clear
							</Button>
							<Button
								variant="default"
								size="sm"
								onClick={() => {
									void stopTerminal();
								}}
								disabled={!canStop || isStopping}
							>
								Stop
							</Button>
						</div>
					</div>
					<div className="h-px bg-border" />
				</>
			) : onClose ? (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: 8,
						padding: "6px 0 0 3px",
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
						<span className="text-text-secondary" style={{ fontSize: 12 }}>
							{minimalHeaderTitle}
						</span>
						{minimalHeaderSubtitle ? (
							<span
								className="truncate font-mono text-text-secondary"
								style={{ fontSize: 10 }}
								title={minimalHeaderSubtitle}
							>
								{minimalHeaderSubtitle}
							</span>
						) : null}
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: 2, marginRight: "-6px" }}>
						{agentLabel && onSendAgentCommand ? (
							<Tooltip side="top" content={`Run ${agentLabel}`}>
								<Button
									icon={<MessageSquare size={12} />}
									variant="ghost"
									size="sm"
									onClick={onSendAgentCommand}
									aria-label={`Run ${agentLabel}`}
								/>
							</Tooltip>
						) : null}
						{onToggleExpand ? (
							<Tooltip
								side="top"
								content={
									<span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
										<span>{isExpanded ? "Collapse" : "Expand"}</span>
										<span
											style={{ display: "inline-flex", alignItems: "center", gap: 2, whiteSpace: "nowrap" }}
										>
											<span>(</span>
											{isMacPlatform ? <Command size={11} /> : <span style={{ fontSize: 11 }}>Ctrl</span>}
											<span>+ M)</span>
										</span>
									</span>
								}
							>
								<Button
									icon={isExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
									variant="ghost"
									size="sm"
									onClick={onToggleExpand}
									aria-label={isExpanded ? "Collapse terminal" : "Expand terminal"}
								/>
							</Tooltip>
						) : null}
						<Button
							icon={<X size={14} />}
							variant="ghost"
							size="sm"
							onClick={onClose}
							aria-label="Close terminal"
						/>
					</div>
				</div>
			) : null}
			<div style={{ flex: "1 1 0", minHeight: 0, overflow: "hidden", padding: "3px 1.5px 3px 3px" }}>
				<div
					ref={containerRef}
					className="kb-terminal-container"
					style={{ height: "100%", width: "100%", background: terminalBackgroundColor }}
				/>
			</div>
			{lastError ? (
				<div
					className="flex gap-2 rounded-none border-t border-status-red/30 bg-status-red/10 p-3 text-[13px] text-status-red"
				>
					{lastError}
				</div>
			) : null}
			{showMoveToTrash && onMoveToTrash ? (
				<div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 12px" }}>
					<AgentTerminalReviewActions
						taskId={taskId}
						taskColumnId={taskColumnId}
						onCommit={onCommit}
						onOpenPr={onOpenPr}
						isCommitLoading={isCommitLoading}
						isOpenPrLoading={isOpenPrLoading}
					/>
					{cancelAutomaticActionLabel && onCancelAutomaticAction ? (
						<Button
							variant="default"
							fill
							onClick={onCancelAutomaticAction}
						>
							{`Cancel Automatic ${cancelAutomaticActionButtonLabel}`}
						</Button>
					) : null}
					<Button
						variant="danger"
						fill
						disabled={isMoveToTrashLoading}
						onClick={onMoveToTrash}
					>
						{isMoveToTrashLoading ? "..." : "Move Card To Trash"}
					</Button>
				</div>
			) : null}
		</div>
	);
}

export function AgentTerminalPanel(props: AgentTerminalPanelProps): ReactElement {
	// enabled gates whether this panel should keep a live persistent terminal connection.
	// We disable it for non-active task contexts so backlog and trash views do not keep extra websocket sockets open.
	const sessionControls = usePersistentTerminalSession({
		taskId: props.taskId,
		workspaceId: props.workspaceId,
		enabled: props.terminalEnabled ?? true,
		onSummary: props.onSummary,
		onConnectionReady: props.onConnectionReady,
		autoFocus: props.autoFocus,
		isVisible: props.isVisible,
		sessionStartedAt: props.summary?.startedAt ?? null,
		terminalBackgroundColor: props.terminalBackgroundColor ?? "var(--color-surface-0)",
		cursorColor: props.cursorColor ?? "var(--color-text-primary)",
	});

	return <AgentTerminalPanelLayout {...props} sessionControls={sessionControls} />;
}
