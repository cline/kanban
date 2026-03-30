// Job Queue Health Dashboard
// Displays live operational status of the background job queue sidecar,
// including queue status counts, worker activity, performance data, and alerts.
// Driven by the job_queue_status_updated WebSocket stream message.

import {
	Activity,
	AlertCircle,
	CheckCircle2,
	Clock,
	Cpu,
	Loader2,
	Pause,
	Play,
	RefreshCw,
	XCircle,
} from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { JobQueueStatus } from "@/runtime/use-runtime-state-stream";

// ─── Helper types from the job queue sidecar JSON output ──────────────────────

interface QueueStats {
	queued: number;
	running: number;
	scheduled_pending: number;
}

interface HealthReport {
	status: "ok" | "degraded";
	summary: QueueStats;
	alerts: string[];
	reasons: string[];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "ok" | "degraded" | null }): ReactElement {
	if (status === null) {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-surface-1 px-2 py-0.5 text-xs text-text-tertiary">
				<Loader2 size={11} className="animate-spin" />
				Waiting
			</span>
		);
	}
	if (status === "ok") {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-500">
				<CheckCircle2 size={11} />
				Healthy
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs text-yellow-500">
			<AlertCircle size={11} />
			Degraded
		</span>
	);
}

function CountCard({
	label,
	value,
	color,
}: {
	label: string;
	value: number | null;
	color: "blue" | "green" | "yellow" | "gray";
}): ReactElement {
	const colorMap = {
		blue: "text-blue-400",
		green: "text-green-400",
		yellow: "text-yellow-400",
		gray: "text-text-secondary",
	};

	return (
		<div className="flex flex-col gap-1 rounded-lg border border-border-primary bg-surface-1 px-4 py-3">
			<span className="text-[11px] uppercase tracking-wide text-text-tertiary">{label}</span>
			<span className={cn("text-2xl font-semibold tabular-nums", colorMap[color])}>
				{value === null ? "—" : value}
			</span>
		</div>
	);
}

function AlertsBanner({ alerts }: { alerts: string[] }): ReactElement | null {
	if (alerts.length === 0) return null;

	return (
		<div className="flex flex-col gap-1 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
			{alerts.map((alert, i) => (
				<div key={i} className="flex items-start gap-2 text-xs text-yellow-400">
					<AlertCircle size={12} className="mt-0.5 shrink-0" />
					<span>{alert}</span>
				</div>
			))}
		</div>
	);
}

// ─── Admin action buttons ──────────────────────────────────────────────────────

function AdminControls({
	workspaceId,
	onRefresh,
}: {
	workspaceId: string | null;
	onRefresh: () => void;
}): ReactElement {
	const [isPausingDefault, setIsPausingDefault] = useState(false);
	const [isResumingDefault, setIsResumingDefault] = useState(false);
	const [isReplayingFailed, setIsReplayingFailed] = useState(false);

	const client = getRuntimeTrpcClient(workspaceId);

	const handlePause = useCallback(async () => {
		setIsPausingDefault(true);
		try {
			await (client as any).jobs.pauseQueue.mutate({ queue: "default", reason: "Manual pause from dashboard" });
			onRefresh();
		} catch {
			// ignore
		} finally {
			setIsPausingDefault(false);
		}
	}, [client, onRefresh]);

	const handleResume = useCallback(async () => {
		setIsResumingDefault(true);
		try {
			await (client as any).jobs.resumeQueue.mutate({ queue: "default", reason: "Manual resume from dashboard" });
			onRefresh();
		} catch {
			// ignore
		} finally {
			setIsResumingDefault(false);
		}
	}, [client, onRefresh]);

	const handleReplayFailed = useCallback(async () => {
		setIsReplayingFailed(true);
		try {
			await (client as any).jobs.replayFailed.mutate({});
			onRefresh();
		} catch {
			// ignore
		} finally {
			setIsReplayingFailed(false);
		}
	}, [client, onRefresh]);

	return (
		<div className="flex items-center gap-2">
			<Button variant="default" size="sm" onClick={() => void handlePause()} disabled={isPausingDefault}>
				{isPausingDefault ? <Loader2 size={13} className="animate-spin" /> : <Pause size={13} />}
				Pause
			</Button>
			<Button variant="default" size="sm" onClick={() => void handleResume()} disabled={isResumingDefault}>
				{isResumingDefault ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
				Resume
			</Button>
			<Button variant="default" size="sm" onClick={() => void handleReplayFailed()} disabled={isReplayingFailed}>
				{isReplayingFailed ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
				Replay Failed
			</Button>
		</div>
	);
}

// ─── Main dashboard ────────────────────────────────────────────────────────────

export interface JobsDashboardProps {
	jobQueueStatus: JobQueueStatus | null;
	workspaceId: string | null;
}

export function JobsDashboard({ jobQueueStatus, workspaceId }: JobsDashboardProps): ReactElement {
	const [refreshNonce, setRefreshNonce] = useState(0);
	const handleRefresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

	const health = jobQueueStatus?.health as HealthReport | null | undefined;
	const sidecarRunning = jobQueueStatus?.sidecarRunning ?? false;

	const queued = health?.summary?.queued ?? null;
	const running = health?.summary?.running ?? null;
	const scheduledPending = health?.summary?.scheduled_pending ?? null;
	const alerts: string[] = health?.alerts ?? [];
	const reasons: string[] = health?.reasons ?? [];
	const allAlerts = [...alerts, ...reasons];

	return (
		<div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 bg-surface-0">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Activity size={16} className="text-text-secondary" />
					<h2 className="text-sm font-semibold text-text-primary">Job Queue</h2>
					<StatusBadge status={!sidecarRunning ? null : (health?.status ?? null)} />
				</div>
				<AdminControls workspaceId={workspaceId} onRefresh={handleRefresh} key={refreshNonce} />
			</div>

			{/* Sidecar not running */}
			{!sidecarRunning && (
				<div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border-primary bg-surface-1 p-8 text-center">
					<XCircle size={32} className="text-text-tertiary" />
					<p className="text-sm font-medium text-text-primary">Job queue sidecar not running</p>
					<p className="text-xs text-text-secondary">
						The job queue binary was not found or is still starting up. Install it or set{" "}
						<code className="rounded bg-surface-0 px-1 font-mono">KANBAN_JOB_QUEUE_BINARY</code>.
					</p>
				</div>
			)}

			{/* Status counts */}
			{sidecarRunning && (
				<>
					<AlertsBanner alerts={allAlerts} />

					<div className="grid grid-cols-3 gap-3">
						<CountCard label="Queued" value={queued} color="blue" />
						<CountCard label="Running" value={running} color="green" />
						<CountCard label="Scheduled" value={scheduledPending} color="yellow" />
					</div>

					{/* Raw health diagnostics (collapsible) */}
					{health && (
						<details className="rounded-lg border border-border-primary bg-surface-1">
							<summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-xs text-text-secondary hover:text-text-primary select-none">
								<Cpu size={12} />
								Raw diagnostics
							</summary>
							<div className="border-t border-border-primary p-4">
								<pre className="overflow-x-auto font-mono text-[10px] text-text-secondary whitespace-pre-wrap">
									{JSON.stringify(health, null, 2)}
								</pre>
							</div>
						</details>
					)}

					{/* Maintenance queue section */}
					<div className="flex flex-col gap-2">
						<p className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
							<Clock size={12} />
							Maintenance queues
						</p>
						<div className="rounded-lg border border-border-primary bg-surface-1 px-4 py-3 text-xs text-text-tertiary">
							Maintenance jobs (git-fetch, stale-session-check, worktree-cleanup) seed automatically 10s after
							the sidecar starts and self-reschedule. Status updates every 30s via the stream.
						</div>
					</div>
				</>
			)}
		</div>
	);
}
