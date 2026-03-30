/**
 * BatchProgressIndicator — banner at the top of the board that shows aggregate
 * progress for an active batch of tasks created via `jobs.createBatch`.
 *
 * Usage:
 *   <BatchProgressIndicator
 *     batchId="abc123"
 *     tasks={[{ taskId, title, columnId }, ...]}
 *     onPauseBatch={() => client.jobs.pauseQueue.mutate(...)}
 *     onCancelRemaining={() => client.jobs.stopWorkflow.mutate(...)}
 *     onDismiss={() => setActiveBatch(null)}
 *   />
 */
import { useState } from "react";
import { Button } from "./ui/button";
import { cn } from "./ui/cn";

export type BatchTaskStatus = "queued" | "running" | "completed" | "failed";

export interface BatchTask {
	taskId: string;
	title: string;
	status: BatchTaskStatus;
}

export interface BatchProgressIndicatorProps {
	batchId: string;
	tasks: BatchTask[];
	queue: string;
	onPauseBatch: () => Promise<void>;
	onCancelRemaining: () => Promise<void>;
	onDismiss: () => void;
}

const STATUS_LABELS: Record<BatchTaskStatus, string> = {
	queued: "Queued",
	running: "Running",
	completed: "Done",
	failed: "Failed",
};

const STATUS_COLORS: Record<BatchTaskStatus, string> = {
	queued: "text-neutral-400",
	running: "text-blue-400",
	completed: "text-green-400",
	failed: "text-red-400",
};

const STATUS_DOT: Record<BatchTaskStatus, string> = {
	queued: "bg-neutral-500",
	running: "bg-blue-500 animate-pulse",
	completed: "bg-green-500",
	failed: "bg-red-500",
};

export function BatchProgressIndicator({
	batchId,
	tasks,
	queue: _queue,
	onPauseBatch,
	onCancelRemaining,
	onDismiss,
}: BatchProgressIndicatorProps) {
	const [expanded, setExpanded] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);

	const completed = tasks.filter((t) => t.status === "completed").length;
	const failed = tasks.filter((t) => t.status === "failed").length;
	const total = tasks.length;
	const progress = total > 0 ? completed / total : 0;
	const allDone = completed + failed === total;

	async function handle(label: string, fn: () => Promise<void>) {
		setBusy(label);
		try {
			await fn();
		} finally {
			setBusy(null);
		}
	}

	return (
		<div className="border border-neutral-800 rounded-lg bg-neutral-900/80 overflow-hidden">
			{/* Header row */}
			<div className="flex items-center gap-3 px-4 py-2.5">
				{/* Progress fraction */}
				<span className="text-xs font-medium text-neutral-300 shrink-0">
					Batch <code className="text-neutral-500 text-[10px]">{batchId}</code>
				</span>
				<span className="text-xs text-neutral-400 shrink-0">
					{completed}/{total} done
					{failed > 0 && <span className="text-red-400 ml-1">· {failed} failed</span>}
				</span>

				{/* Progress bar */}
				<div className="flex-1 h-1.5 rounded-full bg-neutral-800 overflow-hidden">
					<div
						className={cn(
							"h-full rounded-full transition-all duration-500",
							failed > 0 ? "bg-red-500" : "bg-blue-500",
						)}
						style={{ width: `${progress * 100}%` }}
					/>
				</div>

				{/* Expand toggle */}
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="text-xs text-neutral-500 hover:text-neutral-200 transition-colors"
				>
					{expanded ? "▲ Hide" : "▼ Details"}
				</button>

				{/* Controls */}
				{!allDone && (
					<>
						<Button
							variant="ghost"
							className="text-xs px-2 py-1 h-auto"
							disabled={!!busy}
							onClick={() => handle("pause", onPauseBatch)}
						>
							{busy === "pause" ? "…" : "⏸"}
						</Button>
						<Button
							variant="ghost"
							className="text-xs px-2 py-1 h-auto text-red-400 hover:text-red-300"
							disabled={!!busy}
							onClick={() => handle("cancel", onCancelRemaining)}
						>
							{busy === "cancel" ? "…" : "✕"}
						</Button>
					</>
				)}

				{allDone && (
					<button
						type="button"
						onClick={onDismiss}
						className="text-neutral-500 hover:text-neutral-200 text-xs transition-colors"
						title="Dismiss"
					>
						✕
					</button>
				)}
			</div>

			{/* Expanded task list */}
			{expanded && (
				<ul className="border-t border-neutral-800 divide-y divide-neutral-800/50">
					{tasks.map((task) => (
						<li key={task.taskId} className="flex items-center gap-2 px-4 py-1.5">
							<span className={cn("w-1.5 h-1.5 shrink-0 rounded-full", STATUS_DOT[task.status])} />
							<span className="flex-1 text-xs text-neutral-200 truncate">{task.title}</span>
							<span className={cn("text-[10px] font-medium shrink-0", STATUS_COLORS[task.status])}>
								{STATUS_LABELS[task.status]}
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
