/**
 * AuditTimeline — chronological view of automation audit events.
 *
 * Displays all events recorded by automation agents in reverse-chronological
 * order.  Each event is a timestamped row with an icon, instance label, and
 * human-readable description.  Events with structured detail payloads can be
 * expanded inline.
 *
 * This component is used as the "Audit" tab in AutomationsPanel (Project F.3).
 */
import {
	Activity,
	AlertTriangle,
	Bot,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Filter,
	Loader2,
	RefreshCw,
	ShieldAlert,
	Trash2,
	Zap,
} from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

// ─── Local types (mirrors AutomationAuditEvent from automation-types.ts) ─────

interface AuditEvent {
	id: string;
	timestamp: number;
	instanceId: string;
	templateId: string;
	eventType: string;
	details: Record<string, unknown>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
	const diff = Date.now() - ts;
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

function formatAbsoluteTimestamp(ts: number): string {
	return new Date(ts).toLocaleString();
}

interface EventStyle {
	icon: ReactElement;
	colorClass: string;
	label: string;
}

function getEventStyle(eventType: string): EventStyle {
	switch (eventType) {
		case "scan_started":
			return { icon: <Loader2 size={12} />, colorClass: "text-text-secondary", label: "Scan started" };
		case "scan_completed":
			return { icon: <CheckCircle2 size={12} />, colorClass: "text-status-green", label: "Scan completed" };
		case "finding_detected":
			return { icon: <AlertTriangle size={12} />, colorClass: "text-status-gold", label: "Finding detected" };
		case "finding_suppressed_dedup":
			return { icon: <Filter size={12} />, colorClass: "text-text-tertiary", label: "Suppressed (duplicate)" };
		case "finding_suppressed_cooldown":
			return { icon: <Filter size={12} />, colorClass: "text-text-tertiary", label: "Suppressed (cooldown)" };
		case "finding_suppressed_budget":
			return { icon: <Filter size={12} />, colorClass: "text-text-tertiary", label: "Suppressed (budget)" };
		case "task_created":
			return { icon: <Zap size={12} />, colorClass: "text-accent", label: "Task created" };
		case "task_auto_started":
			return { icon: <Activity size={12} />, colorClass: "text-status-blue", label: "Task auto-started" };
		case "remediation_attempted":
			return { icon: <Activity size={12} />, colorClass: "text-text-secondary", label: "Remediation attempted" };
		case "remediation_resolved":
			return { icon: <CheckCircle2 size={12} />, colorClass: "text-status-green", label: "Remediation resolved" };
		case "remediation_abandoned":
			return { icon: <Trash2 size={12} />, colorClass: "text-status-red", label: "Remediation abandoned" };
		case "tripwire_triggered":
			return { icon: <ShieldAlert size={12} />, colorClass: "text-status-red", label: "⚠ Tripwire triggered" };
		case "instance_created":
			return { icon: <Bot size={12} />, colorClass: "text-status-green", label: "Instance created" };
		case "instance_enabled":
			return { icon: <Bot size={12} />, colorClass: "text-status-green", label: "Instance enabled" };
		case "instance_disabled":
			return { icon: <Bot size={12} />, colorClass: "text-text-tertiary", label: "Instance paused" };
		case "instance_deleted":
			return { icon: <Bot size={12} />, colorClass: "text-text-tertiary", label: "Instance deleted" };
		case "manual_scan_triggered":
			return { icon: <Zap size={12} />, colorClass: "text-accent", label: "Manual scan triggered" };
		case "finding_manually_suppressed":
			return { icon: <Filter size={12} />, colorClass: "text-text-secondary", label: "Finding suppressed" };
		case "finding_manually_unsuppressed":
			return { icon: <Filter size={12} />, colorClass: "text-text-secondary", label: "Finding unsuppressed" };
		default:
			return { icon: <Activity size={12} />, colorClass: "text-text-tertiary", label: eventType };
	}
}

/** Build a brief inline description from event type + details payload. */
function buildDescription(eventType: string, details: Record<string, unknown>): string {
	switch (eventType) {
		case "scan_completed":
			return `${details.projectsScanned ?? "?"} project(s) · ${details.tasksCreated ?? 0} task(s) created`;
		case "task_created":
		case "task_auto_started":
			return details.ruleId ? `rule: ${details.ruleId}` : "";
		case "tripwire_triggered":
			return typeof details.reason === "string" ? details.reason : "";
		case "finding_suppressed_budget":
		case "finding_suppressed_cooldown":
		case "finding_suppressed_dedup":
			return typeof details.fingerprint === "string" ? `fp: ${details.fingerprint.slice(0, 12)}…` : "";
		default:
			return "";
	}
}

// ─── EventRow ─────────────────────────────────────────────────────────────────

interface EventRowProps {
	event: AuditEvent;
	instanceLabelById: Record<string, string>;
}

function EventRow({ event, instanceLabelById }: EventRowProps): ReactElement {
	const [expanded, setExpanded] = useState(false);
	const { icon, colorClass, label } = getEventStyle(event.eventType);
	const description = buildDescription(event.eventType, event.details);
	const instanceLabel = instanceLabelById[event.instanceId] ?? `${event.instanceId.slice(0, 8)}…`;
	const hasDetails = Object.keys(event.details).length > 0;

	return (
		<div className="relative pl-6 mb-1">
			{/* Vertical timeline connector */}
			<div className="absolute left-[10px] top-4 bottom-0 w-px bg-border opacity-40" />
			{/* Icon dot */}
			<div className={cn("absolute left-1.5 top-2 flex h-4 w-4 items-center justify-center", colorClass)}>
				{icon}
			</div>

			<div className="rounded-lg border border-border bg-surface-2 overflow-hidden">
				<button
					type="button"
					disabled={!hasDetails}
					className={cn(
						"flex w-full items-start gap-2 px-3 py-2 text-left",
						hasDetails ? "cursor-pointer hover:bg-surface-3" : "cursor-default",
					)}
					onClick={() => {
						if (hasDetails) setExpanded((e) => !e);
					}}
				>
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<div className="flex items-center gap-1.5 min-w-0">
							<span className={cn("shrink-0 text-xs font-medium", colorClass)}>{label}</span>
							<span className="shrink-0 text-xs text-text-tertiary">·</span>
							<span className="truncate text-xs text-text-tertiary">{instanceLabel}</span>
							<span
								className="ml-auto shrink-0 text-xs text-text-tertiary"
								title={formatAbsoluteTimestamp(event.timestamp)}
							>
								{relativeTime(event.timestamp)}
							</span>
						</div>
						{description ? (
							<span className="truncate font-mono text-xs text-text-tertiary">{description}</span>
						) : null}
					</div>
					{hasDetails ? (
						expanded ? (
							<ChevronDown size={12} className="mt-0.5 shrink-0 text-text-tertiary" />
						) : (
							<ChevronRight size={12} className="mt-0.5 shrink-0 text-text-tertiary" />
						)
					) : null}
				</button>

				{expanded && hasDetails ? (
					<div className="border-t border-border bg-surface-1 px-3 py-2">
						{Object.entries(event.details).map(([k, v]) => (
							<div key={k} className="flex gap-2 text-xs">
								<span className="shrink-0 font-mono text-text-tertiary">{k}:</span>
								<span className="font-mono text-text-secondary break-all">{JSON.stringify(v)}</span>
							</div>
						))}
					</div>
				) : null}
			</div>
		</div>
	);
}

// ─── AuditTimeline ────────────────────────────────────────────────────────────

export interface AuditTimelineProps {
	workspaceId: string | null;
}

export function AuditTimeline({ workspaceId }: AuditTimelineProps): ReactElement {
	const [events, setEvents] = useState<AuditEvent[]>([]);
	const [instanceLabelById, setInstanceLabelById] = useState<Record<string, string>>({});
	const [loading, setLoading] = useState(true);
	const [filterInstanceId, setFilterInstanceId] = useState<string>("all");

	const fetchData = useCallback(async () => {
		setLoading(true);
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const [eventsResult, instancesResult] = await Promise.all([
				client.automations.listAuditEvents.query({}),
				client.automations.listInstances.query(),
			]);
			setEvents(eventsResult as unknown as AuditEvent[]);
			const labelById: Record<string, string> = {};
			for (const inst of instancesResult as unknown as Array<{ id: string; label: string }>) {
				labelById[inst.id] = inst.label;
			}
			setInstanceLabelById(labelById);
		} catch {
			// Silent — shows empty state on error.
		} finally {
			setLoading(false);
		}
	}, [workspaceId]);

	useEffect(() => {
		void fetchData();
	}, [fetchData]);

	const filteredEvents = filterInstanceId === "all" ? events : events.filter((e) => e.instanceId === filterInstanceId);

	const instanceOptions = Object.entries(instanceLabelById);

	return (
		<div className="flex flex-col gap-3">
			{/* Controls row */}
			<div className="flex items-center justify-between">
				<span className="text-xs text-text-tertiary">
					{filteredEvents.length} event{filteredEvents.length !== 1 ? "s" : ""}
				</span>
				<div className="flex items-center gap-1.5">
					{instanceOptions.length > 1 ? (
						<select
							className="rounded-md border border-border bg-surface-1 px-2 py-1 text-xs text-text-secondary focus:outline-none focus:border-border-focus"
							value={filterInstanceId}
							onChange={(e) => setFilterInstanceId(e.target.value)}
						>
							<option value="all">All instances</option>
							{instanceOptions.map(([id, lbl]) => (
								<option key={id} value={id}>
									{lbl}
								</option>
							))}
						</select>
					) : null}
					<Button
						size="sm"
						variant="ghost"
						icon={loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
						onClick={() => void fetchData()}
						aria-label="Refresh audit log"
					/>
				</div>
			</div>

			{/* Timeline body */}
			{loading && filteredEvents.length === 0 ? (
				<div className="flex items-center justify-center py-8">
					<Loader2 size={20} className="animate-spin text-text-tertiary" />
				</div>
			) : filteredEvents.length === 0 ? (
				<div className="flex flex-col items-center gap-3 py-8 text-center">
					<Activity size={28} className="text-text-tertiary" />
					<div>
						<p className="text-sm font-medium text-text-secondary">No audit events yet</p>
						<p className="mt-1 text-xs text-text-tertiary">
							Events appear here once automation agents start scanning.
						</p>
					</div>
				</div>
			) : (
				<div className="flex flex-col">
					{filteredEvents.map((event) => (
						<EventRow key={event.id} event={event} instanceLabelById={instanceLabelById} />
					))}
				</div>
			)}
		</div>
	);
}
