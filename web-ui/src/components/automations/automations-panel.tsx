/**
 * AutomationsPanel — top-level control surface for Automation Agents.
 *
 * Tabs: Instances · Findings · Templates
 *
 * Data is fetched on mount via tRPC and refreshed whenever the
 * `automation_updated` WebSocket broadcast arrives (signalled through the
 * `automationStatus` prop changing).
 */
import {
	AlertTriangle,
	Bot,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	FileSearch,
	Loader2,
	Pause,
	Play,
	Plus,
	RefreshCw,
	ShieldAlert,
	Trash2,
	Zap,
} from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";

import { AuditTimeline } from "@/components/automations/audit-timeline";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { AutomationStatus } from "@/runtime/use-runtime-state-stream";

// ─── Types (mirrors src/automations/automation-types.ts) ──────────────────────

interface AutomationPolicyOverrides {
	scanIntervalSeconds?: number;
	maxFindingsPerScan?: number;
	maxTasksPerHour?: number;
	maxAutoStartsPerHour?: number;
	cooldownMinutes?: number;
	severityThreshold?: string;
	allowedActions?: string[];
}

interface AutomationAgentInstance {
	id: string;
	templateId: string;
	label: string;
	projectPaths: string[];
	enabled: boolean;
	policyOverrides: AutomationPolicyOverrides;
	createdAt: number;
	updatedAt: number;
}

interface AutomationFinding {
	fingerprint: string;
	instanceId: string;
	ruleId: string;
	projectPath: string;
	severity: string;
	description: string;
	status: string;
	affectedFiles: string[];
	linkedTaskId: string | null;
	lastSeenAt: number;
}

interface ScanRun {
	id: string;
	instanceId: string;
	templateId: string;
	startedAt: number;
	completedAt: number | null;
	projectsScanned: string[];
	newFindingsCount: number;
	tasksCreated: number;
	tasksAutoStarted: number;
	tripwireTriggered: boolean;
	outcome: string;
	errorMessage: string | null;
}

interface AutomationTemplate {
	id: string;
	name: string;
	description: string;
	version: string;
	ruleIds: string[];
}

// ─── Tab type ─────────────────────────────────────────────────────────────────

type Tab = "instances" | "findings" | "templates" | "audit";

// ─── Props ────────────────────────────────────────────────────────────────────

interface AutomationsPanelProps {
	/** Latest live status from the automation_updated stream message. */
	automationStatus: AutomationStatus | null;
	workspaceId: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function severityColor(severity: string): string {
	switch (severity) {
		case "critical":
			return "text-status-red";
		case "error":
			return "text-status-orange";
		case "warning":
			return "text-status-gold";
		default:
			return "text-text-secondary";
	}
}

function relativeTime(ts: number): string {
	const diff = Date.now() - ts;
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ enabled, tripwired }: { enabled: boolean; tripwired: boolean }): ReactElement {
	if (tripwired) {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-status-red">
				<ShieldAlert size={10} />
				Halted
			</span>
		);
	}
	if (enabled) {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-status-green">
				<CheckCircle2 size={10} />
				Active
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-xs text-text-tertiary">
			<Pause size={10} />
			Paused
		</span>
	);
}

// ─── Instance Row ─────────────────────────────────────────────────────────────

interface InstanceRowProps {
	instance: AutomationAgentInstance;
	recentlyDisabledIds: string[];
	onToggle: (id: string, enable: boolean) => Promise<void>;
	onRunNow: (id: string) => Promise<void>;
	onDelete: (id: string) => Promise<void>;
}

function InstanceRow({ instance, recentlyDisabledIds, onToggle, onRunNow, onDelete }: InstanceRowProps): ReactElement {
	const [toggling, setToggling] = useState(false);
	const [running, setRunning] = useState(false);
	const tripwired = recentlyDisabledIds.includes(instance.id);

	const handleToggle = async () => {
		setToggling(true);
		try {
			await onToggle(instance.id, !instance.enabled);
		} finally {
			setToggling(false);
		}
	};

	const handleRunNow = async () => {
		setRunning(true);
		try {
			await onRunNow(instance.id);
		} finally {
			setTimeout(() => setRunning(false), 2000);
		}
	};

	return (
		<div
			className={cn(
				"flex flex-col gap-2 rounded-lg border bg-surface-2 p-3 transition-colors",
				tripwired ? "border-status-red/50" : "border-border",
			)}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="flex min-w-0 flex-col gap-0.5">
					<span className="truncate text-sm font-medium text-text-primary">{instance.label}</span>
					<span className="truncate text-xs text-text-tertiary">{instance.templateId}</span>
				</div>
				<StatusBadge enabled={instance.enabled} tripwired={tripwired} />
			</div>

			{instance.projectPaths.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{instance.projectPaths.slice(0, 3).map((p) => (
						<span key={p} className="rounded bg-surface-1 px-1.5 py-0.5 font-mono text-xs text-text-tertiary">
							{p.split("/").at(-1) ?? p}
						</span>
					))}
					{instance.projectPaths.length > 3 && (
						<span className="rounded bg-surface-1 px-1.5 py-0.5 text-xs text-text-tertiary">
							+{instance.projectPaths.length - 3}
						</span>
					)}
				</div>
			)}

			<div className="flex items-center gap-1.5">
				<Button
					size="sm"
					variant={instance.enabled ? "default" : "primary"}
					icon={
						toggling ? (
							<Loader2 size={12} className="animate-spin" />
						) : instance.enabled ? (
							<Pause size={12} />
						) : (
							<Play size={12} />
						)
					}
					onClick={() => void handleToggle()}
					aria-label={instance.enabled ? "Pause instance" : "Enable instance"}
				>
					{instance.enabled ? "Pause" : "Enable"}
				</Button>
				<Button
					size="sm"
					variant="ghost"
					icon={running ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
					onClick={() => void handleRunNow()}
					aria-label="Run scan now"
				>
					Scan now
				</Button>
				<div className="ml-auto">
					<Button
						size="sm"
						variant="ghost"
						icon={<Trash2 size={12} />}
						onClick={() => void onDelete(instance.id)}
						aria-label="Delete instance"
						className="text-text-tertiary hover:text-status-red"
					/>
				</div>
			</div>
		</div>
	);
}

// ─── Finding Row ──────────────────────────────────────────────────────────────

interface FindingRowProps {
	finding: AutomationFinding;
	onSuppress: (fingerprint: string) => Promise<void>;
}

function FindingRow({ finding, onSuppress }: FindingRowProps): ReactElement {
	const [expanded, setExpanded] = useState(false);
	const [suppressing, setSuppressing] = useState(false);

	const handleSuppress = async () => {
		setSuppressing(true);
		try {
			await onSuppress(finding.fingerprint);
		} finally {
			setSuppressing(false);
		}
	};

	return (
		<div className="rounded-lg border border-border bg-surface-2 overflow-hidden">
			<button
				type="button"
				className="flex w-full items-start gap-2 p-3 text-left hover:bg-surface-3 transition-colors"
				onClick={() => setExpanded((e) => !e)}
			>
				{expanded ? (
					<ChevronDown size={14} className="mt-0.5 shrink-0 text-text-tertiary" />
				) : (
					<ChevronRight size={14} className="mt-0.5 shrink-0 text-text-tertiary" />
				)}
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className={cn("text-xs font-medium", severityColor(finding.severity))}>
						{finding.severity.toUpperCase()} · {finding.ruleId}
					</span>
					<span className="truncate text-sm text-text-primary">{finding.description}</span>
					<span className="text-xs text-text-tertiary">
						{finding.projectPath.split("/").at(-1)} · {relativeTime(finding.lastSeenAt)}
						{finding.linkedTaskId && " · task linked"}
					</span>
				</div>
			</button>
			{expanded && (
				<div className="border-t border-border px-3 pb-3 pt-2">
					{finding.affectedFiles.length > 0 && (
						<div className="mb-2">
							<p className="mb-1 text-xs font-medium text-text-secondary">Affected files</p>
							<ul className="space-y-0.5">
								{finding.affectedFiles.slice(0, 5).map((f) => (
									<li key={f} className="font-mono text-xs text-text-tertiary">
										{f}
									</li>
								))}
							</ul>
						</div>
					)}
					<Button
						size="sm"
						variant="ghost"
						icon={suppressing ? <Loader2 size={12} className="animate-spin" /> : <ShieldAlert size={12} />}
						onClick={() => void handleSuppress()}
						className="text-text-tertiary hover:text-status-red"
					>
						Suppress
					</Button>
				</div>
			)}
		</div>
	);
}

// ─── Template Card ────────────────────────────────────────────────────────────

interface TemplateCardProps {
	template: AutomationTemplate;
	instanceCount: number;
	onCreateInstance: (templateId: string) => void;
}

function TemplateCard({ template, instanceCount, onCreateInstance }: TemplateCardProps): ReactElement {
	return (
		<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
			<div className="flex items-start justify-between gap-2">
				<div className="flex flex-col gap-0.5">
					<span className="text-sm font-medium text-text-primary">{template.name}</span>
					<span className="text-xs text-text-tertiary">
						v{template.version} · {template.ruleIds.length} rules
					</span>
				</div>
				{instanceCount > 0 && (
					<span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
						{instanceCount} instance{instanceCount !== 1 ? "s" : ""}
					</span>
				)}
			</div>
			<p className="text-xs text-text-secondary">{template.description}</p>
			<Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => onCreateInstance(template.id)}>
				Create instance
			</Button>
		</div>
	);
}

// ─── Create Instance Inline Form ──────────────────────────────────────────────

interface CreateInstanceFormProps {
	templates: AutomationTemplate[];
	projectPaths: string[];
	onCreated: () => void;
	onCancel: () => void;
}

function CreateInstanceForm({ templates, projectPaths, onCreated, onCancel }: CreateInstanceFormProps): ReactElement {
	const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
	const [label, setLabel] = useState("");
	const [selectedPaths, setSelectedPaths] = useState<string[]>(projectPaths.slice(0, 1));
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleCreate = async (autoEnable: boolean) => {
		if (!label.trim() || !templateId) return;
		setCreating(true);
		setError(null);
		try {
			const client = getRuntimeTrpcClient(null);
			const instance = await client.automations.createInstance.mutate({
				templateId,
				label: label.trim(),
				projectPaths: selectedPaths,
			});
			if (autoEnable) {
				await client.automations.enableInstance.mutate({ id: instance.id });
			}
			onCreated();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setCreating(false);
		}
	};

	const togglePath = (path: string) => {
		setSelectedPaths((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
	};

	return (
		<div className="rounded-lg border border-accent/40 bg-surface-2 p-3">
			<p className="mb-3 text-sm font-medium text-text-primary">New Automation Instance</p>

			<div className="mb-2">
				<label htmlFor="create-automation-template" className="mb-1 block text-xs text-text-secondary">
					Template
				</label>
				<select
					id="create-automation-template"
					className="w-full rounded-md border border-border bg-surface-1 px-2 py-1 text-sm text-text-primary focus:border-border-focus focus:outline-none"
					value={templateId}
					onChange={(e) => setTemplateId(e.target.value)}
				>
					{templates.map((t) => (
						<option key={t.id} value={t.id}>
							{t.name}
						</option>
					))}
				</select>
			</div>

			<div className="mb-2">
				<label htmlFor="create-automation-label" className="mb-1 block text-xs text-text-secondary">
					Label
				</label>
				<input
					id="create-automation-label"
					type="text"
					placeholder="e.g. Quality Enforcer - My Project"
					className="w-full rounded-md border border-border bg-surface-1 px-2 py-1 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
					value={label}
					onChange={(e) => setLabel(e.target.value)}
				/>
			</div>

			{projectPaths.length > 0 && (
				<div className="mb-3">
					<p className="mb-1 text-xs text-text-secondary">Projects to monitor</p>
					<div className="flex flex-col gap-1">
						{projectPaths.map((p) => (
							<label
								key={p}
								className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary hover:text-text-primary"
							>
								<input
									type="checkbox"
									checked={selectedPaths.includes(p)}
									onChange={() => togglePath(p)}
									className="accent-accent"
								/>
								<span className="truncate">{p.split("/").at(-1) ?? p}</span>
							</label>
						))}
					</div>
				</div>
			)}

			{error && <p className="mb-2 text-xs text-status-red">{error}</p>}

			<div className="flex gap-1.5">
				<Button
					size="sm"
					variant="primary"
					icon={creating ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
					onClick={() => void handleCreate(true)}
				>
					Create &amp; Enable
				</Button>
				<Button size="sm" variant="default" onClick={() => void handleCreate(false)}>
					Create (Paused)
				</Button>
				<Button size="sm" variant="ghost" onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</div>
	);
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function AutomationsPanel({ automationStatus, workspaceId }: AutomationsPanelProps): ReactElement {
	const [activeTab, setActiveTab] = useState<Tab>("instances");
	const [instances, setInstances] = useState<AutomationAgentInstance[]>([]);
	const [findings, setFindings] = useState<AutomationFinding[]>([]);
	const [scanRuns, setScanRuns] = useState<ScanRun[]>([]);
	const [templates, setTemplates] = useState<AutomationTemplate[]>([]);
	const [loading, setLoading] = useState(true);
	const [showCreateForm, setShowCreateForm] = useState(false);

	// Derive project paths from the workspace — we pass [] and let user pick.
	// In future iterations this could come from the workspace state.
	const [projectPaths] = useState<string[]>([]);

	const fetchData = useCallback(async () => {
		setLoading(true);
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const [instancesResult, findingsResult, templatesResult] = await Promise.all([
				client.automations.listInstances.query(),
				client.automations.listFindings.query({}),
				client.automations.listTemplates.query(),
			]);
			setInstances(instancesResult as unknown as AutomationAgentInstance[]);
			setFindings(findingsResult as unknown as AutomationFinding[]);
			setTemplates(templatesResult as unknown as AutomationTemplate[]);

			// Fetch recent scan runs for all instances.
			if (instancesResult.length > 0) {
				const runsResults = await Promise.all(
					instancesResult.map((inst) => client.automations.listScanRuns.query({ instanceId: inst.id })),
				);
				setScanRuns(runsResults.flat() as unknown as ScanRun[]);
			}
		} catch {
			// Silently handle: panel will show empty state.
		} finally {
			setLoading(false);
		}
	}, [workspaceId]);

	// Initial load + re-fetch when workspaceId changes.
	useEffect(() => {
		void fetchData();
	}, [fetchData]);

	// Re-fetch whenever the live automation_updated broadcast arrives.
	useEffect(() => {
		if (automationStatus) {
			void fetchData();
		}
	}, [automationStatus, fetchData]);

	const handleToggle = async (id: string, enable: boolean) => {
		const client = getRuntimeTrpcClient(workspaceId);
		if (enable) {
			await client.automations.enableInstance.mutate({ id });
		} else {
			await client.automations.disableInstance.mutate({ id });
		}
		await fetchData();
	};

	const handleRunNow = async (id: string) => {
		const client = getRuntimeTrpcClient(workspaceId);
		await client.automations.triggerScan.mutate({ instanceId: id });
	};

	const handleDelete = async (id: string) => {
		const client = getRuntimeTrpcClient(workspaceId);
		await client.automations.deleteInstance.mutate({ id });
		await fetchData();
	};

	const handleSuppress = async (fingerprint: string) => {
		const client = getRuntimeTrpcClient(workspaceId);
		await client.automations.suppressFinding.mutate({ fingerprint });
		await fetchData();
	};

	const recentlyDisabledIds = automationStatus?.recentlyDisabledInstanceIds ?? [];
	const openFindings = findings.filter(
		(f) => f.status === "open" || f.status === "task_created" || f.status === "task_started",
	);

	// ── Summary bar ───────────────────────────────────────────────────────────
	const enabledCount = instances.filter((i) => i.enabled).length;
	const openFindingsCount = automationStatus?.openFindingsCount ?? openFindings.length;

	return (
		<div className="flex h-full flex-col bg-surface-0">
			{/* Header */}
			<div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
				<div className="flex items-center gap-2">
					<Bot size={16} className="text-accent" />
					<span className="text-sm font-semibold text-text-primary">Automation Agents</span>
				</div>
				<div className="flex items-center gap-2">
					{/* Summary badges */}
					<span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-secondary">
						{enabledCount} active
					</span>
					{openFindingsCount > 0 && (
						<span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs text-status-gold">
							{openFindingsCount} finding{openFindingsCount !== 1 ? "s" : ""}
						</span>
					)}
					<Button
						size="sm"
						variant="ghost"
						icon={loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
						onClick={() => void fetchData()}
						aria-label="Refresh"
					/>
				</div>
			</div>

			{/* Tripwire alert */}
			{recentlyDisabledIds.length > 0 && (
				<div className="shrink-0 flex items-center gap-2 border-b border-status-red/30 bg-status-red/10 px-4 py-2 text-xs text-status-red">
					<AlertTriangle size={12} />
					<span>
						{recentlyDisabledIds.length} instance{recentlyDisabledIds.length !== 1 ? "s" : ""} halted by tripwire
						— review and re-enable.
					</span>
				</div>
			)}

			{/* Tab bar */}
			<div className="flex shrink-0 border-b border-border px-4">
				{(["instances", "findings", "templates", "audit"] as Tab[]).map((tab) => (
					<button
						key={tab}
						type="button"
						className={cn(
							"border-b-2 px-3 py-2 text-xs font-medium transition-colors capitalize",
							activeTab === tab
								? "border-accent text-accent"
								: "border-transparent text-text-secondary hover:text-text-primary",
						)}
						onClick={() => setActiveTab(tab)}
					>
						{tab}
						{tab === "findings" && openFindingsCount > 0 && (
							<span className="ml-1.5 rounded-full bg-yellow-500/20 px-1.5 py-0.5 text-xs text-status-gold">
								{openFindingsCount}
							</span>
						)}
					</button>
				))}
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto px-4 py-3">
				{loading ? (
					<div className="flex items-center justify-center py-8">
						<Loader2 size={20} className="animate-spin text-text-tertiary" />
					</div>
				) : activeTab === "instances" ? (
					<InstancesTab
						instances={instances}
						recentlyDisabledIds={recentlyDisabledIds}
						scanRuns={scanRuns}
						templates={templates}
						projectPaths={projectPaths}
						showCreateForm={showCreateForm}
						setShowCreateForm={setShowCreateForm}
						onToggle={handleToggle}
						onRunNow={handleRunNow}
						onDelete={handleDelete}
						onRefresh={fetchData}
					/>
				) : activeTab === "findings" ? (
					<FindingsTab findings={openFindings} onSuppress={handleSuppress} />
				) : activeTab === "audit" ? (
					<AuditTimeline workspaceId={workspaceId} />
				) : (
					<TemplatesTab
						templates={templates}
						instances={instances}
						onCreateInstance={(templateId) => {
							setActiveTab("instances");
							setShowCreateForm(true);
							// Pre-select the template (future: pass default templateId to form)
							void templateId;
						}}
					/>
				)}
			</div>
		</div>
	);
}

// ─── Instances Tab ────────────────────────────────────────────────────────────

interface InstancesTabProps {
	instances: AutomationAgentInstance[];
	recentlyDisabledIds: string[];
	scanRuns: ScanRun[];
	templates: AutomationTemplate[];
	projectPaths: string[];
	showCreateForm: boolean;
	setShowCreateForm: (v: boolean) => void;
	onToggle: (id: string, enable: boolean) => Promise<void>;
	onRunNow: (id: string) => Promise<void>;
	onDelete: (id: string) => Promise<void>;
	onRefresh: () => Promise<void>;
}

function InstancesTab({
	instances,
	recentlyDisabledIds,
	templates,
	projectPaths,
	showCreateForm,
	setShowCreateForm,
	onToggle,
	onRunNow,
	onDelete,
	onRefresh,
}: InstancesTabProps): ReactElement {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between">
				<span className="text-xs text-text-tertiary">
					{instances.length} instance{instances.length !== 1 ? "s" : ""}
				</span>
				<Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => setShowCreateForm(true)}>
					New instance
				</Button>
			</div>

			{showCreateForm && (
				<CreateInstanceForm
					templates={templates}
					projectPaths={projectPaths}
					onCreated={async () => {
						setShowCreateForm(false);
						await onRefresh();
					}}
					onCancel={() => setShowCreateForm(false)}
				/>
			)}

			{instances.length === 0 && !showCreateForm ? (
				<div className="flex flex-col items-center gap-3 py-8 text-center">
					<Bot size={28} className="text-text-tertiary" />
					<div>
						<p className="text-sm font-medium text-text-secondary">No automation agents yet</p>
						<p className="mt-1 text-xs text-text-tertiary">
							Create an instance from the Templates tab to start automating.
						</p>
					</div>
					<Button size="sm" variant="primary" icon={<Plus size={12} />} onClick={() => setShowCreateForm(true)}>
						New instance
					</Button>
				</div>
			) : (
				instances.map((instance) => (
					<InstanceRow
						key={instance.id}
						instance={instance}
						recentlyDisabledIds={recentlyDisabledIds}
						onToggle={onToggle}
						onRunNow={onRunNow}
						onDelete={onDelete}
					/>
				))
			)}
		</div>
	);
}

// ─── Findings Tab ─────────────────────────────────────────────────────────────

function FindingsTab({
	findings,
	onSuppress,
}: {
	findings: AutomationFinding[];
	onSuppress: (fp: string) => Promise<void>;
}): ReactElement {
	if (findings.length === 0) {
		return (
			<div className="flex flex-col items-center gap-3 py-8 text-center">
				<FileSearch size={28} className="text-text-tertiary" />
				<div>
					<p className="text-sm font-medium text-text-secondary">No open findings</p>
					<p className="mt-1 text-xs text-text-tertiary">All clear! Automation agents have nothing to report.</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<span className="text-xs text-text-tertiary">
				{findings.length} open finding{findings.length !== 1 ? "s" : ""}
			</span>
			{findings.map((f) => (
				<FindingRow key={f.fingerprint} finding={f} onSuppress={onSuppress} />
			))}
		</div>
	);
}

// ─── Templates Tab ────────────────────────────────────────────────────────────

function TemplatesTab({
	templates,
	instances,
	onCreateInstance,
}: {
	templates: AutomationTemplate[];
	instances: AutomationAgentInstance[];
	onCreateInstance: (templateId: string) => void;
}): ReactElement {
	if (templates.length === 0) {
		return (
			<div className="flex flex-col items-center gap-3 py-8 text-center">
				<Bot size={28} className="text-text-tertiary" />
				<p className="text-sm text-text-secondary">No templates registered.</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			{templates.map((t) => (
				<TemplateCard
					key={t.id}
					template={t}
					instanceCount={instances.filter((i) => i.templateId === t.id).length}
					onCreateInstance={onCreateInstance}
				/>
			))}
		</div>
	);
}
