import { AlertTriangle, ArrowUpCircle, Check, CheckCircle2, Copy } from "lucide-react";
import { useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { runRuntimeUpdateNow } from "@/runtime/runtime-config-query";
import type { RuntimeRunUpdateResponse } from "@/runtime/types";

interface UpdateAvailableDialogProps {
	open: boolean;
	currentVersion: string;
	latestVersion: string;
	installCommand: string;
	onClose: () => void;
}

type DialogPhase =
	| { kind: "idle" }
	| { kind: "running" }
	| { kind: "success"; result: RuntimeRunUpdateResponse }
	| { kind: "error"; message: string };

function isSuccessStatus(status: RuntimeRunUpdateResponse["status"]): boolean {
	return status === "updated" || status === "already_up_to_date" || status === "cache_refreshed";
}

export function UpdateAvailableDialog({
	open,
	currentVersion,
	latestVersion,
	installCommand,
	onClose,
}: UpdateAvailableDialogProps): React.ReactElement {
	const [copied, setCopied] = useState(false);
	const [phase, setPhase] = useState<DialogPhase>({ kind: "idle" });

	const handleCopy = async (): Promise<void> => {
		try {
			await navigator.clipboard.writeText(installCommand);
			setCopied(true);
			setTimeout(() => {
				setCopied(false);
			}, 1500);
		} catch {
			showAppToast(
				{
					intent: "warning",
					message: "Could not copy the update command. Select it and copy manually.",
					timeout: 4000,
				},
				"update-command-copy-failed",
			);
		}
	};

	const handleUpdateNow = async (): Promise<void> => {
		setPhase({ kind: "running" });
		try {
			const result = await runRuntimeUpdateNow(null);
			if (isSuccessStatus(result.status)) {
				setPhase({ kind: "success", result });
			} else {
				setPhase({ kind: "error", message: result.message });
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to run update.";
			setPhase({ kind: "error", message });
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					onClose();
				}
			}}
		>
			<DialogHeader title="New version available" icon={<ArrowUpCircle size={16} className="text-status-blue" />} />
			<DialogBody className="flex flex-col gap-3 text-[13px] text-text-secondary">
				{phase.kind === "success" ? (
					<div className="flex items-start gap-2 text-text-primary">
						<CheckCircle2 size={16} className="mt-0.5 shrink-0 text-status-green" />
						<p>
							{phase.result.status === "updated" && phase.result.latestVersion ? (
								<>
									Updated to <span className="font-semibold">Kanban {phase.result.latestVersion}</span>.
									Restart Kanban to use the new version.
								</>
							) : (
								phase.result.message
							)}
						</p>
					</div>
				) : (
					<>
						<p>
							<span className="font-semibold text-text-primary">Kanban {latestVersion}</span> is available. You
							are currently on version {currentVersion}.
						</p>
						<p>Run the following command in your terminal to update:</p>
						<div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-text-primary">
							<code className="flex-1 truncate">{installCommand}</code>
							<button
								type="button"
								onClick={() => {
									void handleCopy();
								}}
								aria-label={copied ? "Copied" : "Copy command"}
								className="shrink-0 rounded p-1 text-text-tertiary hover:bg-surface-3 hover:text-text-primary cursor-pointer"
							>
								{copied ? <Check size={14} className="text-status-green" /> : <Copy size={14} />}
							</button>
						</div>
						{phase.kind === "error" ? (
							<div className="flex items-start gap-2 rounded-md border border-status-red/30 bg-status-red/10 px-3 py-2 text-status-red">
								<AlertTriangle size={16} className="mt-0.5 shrink-0" />
								<p className="text-[12px]">{phase.message}</p>
							</div>
						) : null}
					</>
				)}
			</DialogBody>
			<DialogFooter>
				{phase.kind === "success" ? (
					<Button variant="primary" onClick={onClose}>
						Close
					</Button>
				) : (
					<>
						<Button variant="default" onClick={onClose}>
							Later
						</Button>
						<Button
							variant="primary"
							onClick={() => {
								void handleUpdateNow();
							}}
							disabled={phase.kind === "running"}
							icon={phase.kind === "running" ? <Spinner size={14} className="text-accent-fg" /> : undefined}
						>
							{phase.kind === "running" ? "Updating…" : "Update Now"}
						</Button>
					</>
				)}
			</DialogFooter>
		</Dialog>
	);
}
