import "@xterm/xterm/css/xterm.css";

import { Button, Callout, Classes, Colors, Divider, Icon, Tag, Tooltip } from "@blueprintjs/core";
import type { MutableRefObject, ReactElement } from "react";
import { useMemo } from "react";

import { panelSeparatorColor } from "@/data/column-colors";
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

function getStateIntent(summary: RuntimeTaskSessionSummary | null): "none" | "success" | "warning" | "danger" {
	if (!summary) {
		return "none";
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
	return "none";
}

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
				text="Commit"
				size="small"
				variant="solid"
				intent="primary"
				style={{ flex: "1 1 0" }}
				loading={isCommitLoading}
				disabled={isCommitLoading || isOpenPrLoading}
				onClick={onCommit}
			/>
			<Button
				text="Open PR"
				size="small"
				variant="solid"
				intent="primary"
				style={{ flex: "1 1 0" }}
				loading={isOpenPrLoading}
				disabled={isCommitLoading || isOpenPrLoading}
				onClick={onOpenPr}
			/>
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
	panelBackgroundColor = Colors.DARK_GRAY1,
	terminalBackgroundColor = Colors.DARK_GRAY1,
	cursorColor: _cursorColor = Colors.LIGHT_GRAY5,
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
	const statusIntent = useMemo(() => getStateIntent(summary), [summary]);
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
				borderRight: showRightBorder ? `1px solid ${panelSeparatorColor}` : undefined,
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
							<Tag intent={statusIntent} minimal>
								{statusLabel}
							</Tag>
						</div>
						<div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
							<Button text="Clear" variant="outlined" size="small" onClick={clearTerminal} />
							<Button
								text="Stop"
								variant="outlined"
								size="small"
								onClick={() => {
									void stopTerminal();
								}}
								disabled={!canStop || isStopping}
							/>
						</div>
					</div>
					<Divider />
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
						<span className={Classes.TEXT_MUTED} style={{ fontSize: "var(--bp-typography-size-body-small)" }}>
							{minimalHeaderTitle}
						</span>
						{minimalHeaderSubtitle ? (
							<span
								className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT} ${Classes.TEXT_OVERFLOW_ELLIPSIS}`}
								style={{ fontSize: "var(--bp-typography-size-body-x-small)" }}
								title={minimalHeaderSubtitle}
							>
								{minimalHeaderSubtitle}
							</span>
						) : null}
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: 2, marginRight: "-6px" }}>
						{agentLabel && onSendAgentCommand ? (
							<Tooltip placement="top" content={`Run ${agentLabel}`}>
								<Button
									icon={<Icon icon="chat" size={12} />}
									variant="minimal"
									size="small"
									onClick={onSendAgentCommand}
									aria-label={`Run ${agentLabel}`}
								/>
							</Tooltip>
						) : null}
						{onToggleExpand ? (
							<Tooltip
								placement="top"
								content={
									<span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
										<span>{isExpanded ? "Collapse" : "Expand"}</span>
										<span
											style={{ display: "inline-flex", alignItems: "center", gap: 2, whiteSpace: "nowrap" }}
										>
											<span>(</span>
											<Icon icon={isMacPlatform ? "key-command" : "key-control"} size={11} />
											<span>+ M)</span>
										</span>
									</span>
								}
							>
								<Button
									icon={<Icon icon={isExpanded ? "minimize" : "maximize"} size={12} />}
									variant="minimal"
									size="small"
									onClick={onToggleExpand}
									aria-label={isExpanded ? "Collapse terminal" : "Expand terminal"}
								/>
							</Tooltip>
						) : null}
						<Button icon="cross" variant="minimal" size="small" onClick={onClose} aria-label="Close terminal" />
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
				<Callout intent="danger" compact style={{ borderRadius: 0 }}>
					{lastError}
				</Callout>
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
							text={`Cancel Automatic ${cancelAutomaticActionButtonLabel}`}
							variant="outlined"
							fill
							onClick={onCancelAutomaticAction}
						/>
					) : null}
					<Button
						intent="danger"
						text="Move Card To Trash"
						fill
						loading={isMoveToTrashLoading}
						disabled={isMoveToTrashLoading}
						onClick={onMoveToTrash}
					/>
				</div>
			) : null}
		</div>
	);
}

export function AgentTerminalPanel(props: AgentTerminalPanelProps): ReactElement {
	const sessionControls = usePersistentTerminalSession({
		taskId: props.taskId,
		workspaceId: props.workspaceId,
		onSummary: props.onSummary,
		onConnectionReady: props.onConnectionReady,
		autoFocus: props.autoFocus,
		isVisible: props.isVisible,
		sessionStartedAt: props.summary?.startedAt ?? null,
		terminalBackgroundColor: props.terminalBackgroundColor ?? Colors.DARK_GRAY1,
		cursorColor: props.cursorColor ?? Colors.LIGHT_GRAY5,
	});

	return <AgentTerminalPanelLayout {...props} sessionControls={sessionControls} />;
}
