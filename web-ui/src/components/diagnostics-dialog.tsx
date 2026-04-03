import { Activity } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import type { DiagnosticsData, DiagnosticsWsState } from "@/hooks/use-diagnostics";

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function wsStateLabel(state: DiagnosticsWsState): string {
	switch (state) {
		case "connected":
			return "Connected";
		case "disconnected":
			return "Disconnected";
		case "reconnecting":
			return "Reconnecting";
	}
}

function wsStateDot(state: DiagnosticsWsState): string {
	switch (state) {
		case "connected":
			return "bg-status-green";
		case "disconnected":
			return "bg-status-red";
		case "reconnecting":
			return "bg-status-yellow";
	}
}

function authLabel(status: DiagnosticsData["authStatus"]): string {
	switch (status) {
		case "authenticated":
			return "Authenticated";
		case "unauthenticated":
			return "Not authenticated";
		case "unknown":
			return "Unknown";
	}
}

function authDot(status: DiagnosticsData["authStatus"]): string {
	switch (status) {
		case "authenticated":
			return "bg-status-green";
		case "unauthenticated":
			return "bg-status-red";
		case "unknown":
			return "bg-text-tertiary";
	}
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

function DiagnosticRow({ label, value, dotColor }: { label: string; value: string; dotColor?: string }): ReactElement {
	return (
		<div className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
			<span className="text-xs text-text-secondary">{label}</span>
			<span className="flex items-center gap-2 text-xs font-medium text-text-primary">
				{dotColor ? <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} /> : null}
				{value}
			</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// DiagnosticsDialog
// ---------------------------------------------------------------------------

export function DiagnosticsDialog({
	open,
	onOpenChange,
	diagnostics,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	diagnostics: DiagnosticsData;
}): ReactElement {
	return (
		<Dialog open={open} onOpenChange={onOpenChange} contentAriaDescribedBy="diagnostics-description">
			<DialogHeader title="Diagnostics" icon={<Activity size={16} />} />
			<DialogBody className="space-y-1">
				<p id="diagnostics-description" className="sr-only">
					Runtime connection diagnostics information.
				</p>
				<div className="rounded-md border border-border bg-surface-2 px-3 py-1">
					<DiagnosticRow
						label="Connection type"
						value={diagnostics.connectionType === "local" ? "Local" : "Remote"}
					/>
					<DiagnosticRow
						label="Latency"
						value={diagnostics.latencyMs !== null ? `${diagnostics.latencyMs} ms` : "—"}
					/>
					<DiagnosticRow label="Runtime version" value={diagnostics.runtimeVersion || "—"} />
					<DiagnosticRow
						label="WebSocket state"
						value={wsStateLabel(diagnostics.wsState)}
						dotColor={wsStateDot(diagnostics.wsState)}
					/>
					<DiagnosticRow
						label="Auth status"
						value={authLabel(diagnostics.authStatus)}
						dotColor={authDot(diagnostics.authStatus)}
					/>
				</div>
			</DialogBody>
			<DialogFooter>
				<Button variant="default" onClick={() => onOpenChange(false)}>
					Close
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
