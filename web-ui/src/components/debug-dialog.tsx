import { Bug, RotateCcw } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogBody,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Dialog,
	DialogBody,
	DialogFooter,
	DialogHeader,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

export function DebugDialog({
	open,
	onOpenChange,
	isResetAllStatePending,
	onShowStartupOnboardingDialog,
	onResetAllState,
}: {
	open: boolean;
	onOpenChange: (nextOpen: boolean) => void;
	isResetAllStatePending: boolean;
	onShowStartupOnboardingDialog: () => void;
	onResetAllState: () => void;
}): ReactElement {
	const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

	useEffect(() => {
		if (!open) {
			setIsResetConfirmOpen(false);
		}
	}, [open]);

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogHeader title="Debug tools" icon={<Bug size={16} />} />
				<DialogBody className="space-y-4">
					<div className="rounded-md border border-border bg-surface-2 p-3">
						<p className="text-sm font-medium text-text-primary">Show onboarding dialog</p>
						<p className="mt-1 text-xs text-text-secondary">
							Reopen the startup onboarding dialog so you can verify onboarding flows.
						</p>
						<Button
							variant="default"
							size="sm"
							disabled={isResetAllStatePending}
							onClick={onShowStartupOnboardingDialog}
							className="mt-3"
						>
							Show onboarding
						</Button>
					</div>
					<div className="rounded-md border border-border bg-surface-2 p-3">
						<p className="text-sm font-medium text-text-primary">Reset all state</p>
						<p className="mt-1 text-xs text-text-secondary">
							Clears browser local storage and removes <code>~/.cline/data</code>, <code>~/.cline/kanban</code>,
							and <code>~/.cline/worktrees</code>. Kanban reloads after completion.
						</p>
						<Button
							variant="danger"
							size="sm"
							icon={isResetAllStatePending ? <Spinner size={12} /> : <RotateCcw size={14} />}
							disabled={isResetAllStatePending}
							onClick={() => setIsResetConfirmOpen(true)}
							className="mt-3"
						>
							{isResetAllStatePending ? "Resetting..." : "Reset all state"}
						</Button>
					</div>
				</DialogBody>
				<DialogFooter>
					<Button variant="default" onClick={() => onOpenChange(false)} disabled={isResetAllStatePending}>
						Close
					</Button>
				</DialogFooter>
			</Dialog>

			<AlertDialog open={isResetConfirmOpen} onOpenChange={setIsResetConfirmOpen}>
				<AlertDialogHeader>
					<AlertDialogTitle>Reset all state?</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogBody>
					<AlertDialogDescription>
						This removes local browser storage and deletes <code>~/.cline/data</code>,{" "}
						<code>~/.cline/kanban</code>, and <code>~/.cline/worktrees</code>.
					</AlertDialogDescription>
					<p className="text-text-primary">This action cannot be undone.</p>
				</AlertDialogBody>
				<AlertDialogFooter>
					<AlertDialogCancel asChild>
						<Button variant="default" disabled={isResetAllStatePending}>
							Cancel
						</Button>
					</AlertDialogCancel>
					<AlertDialogAction asChild>
						<Button
							variant="danger"
							icon={isResetAllStatePending ? <Spinner size={12} /> : <RotateCcw size={14} />}
							disabled={isResetAllStatePending}
							onClick={onResetAllState}
						>
							{isResetAllStatePending ? "Resetting..." : "Reset all state"}
						</Button>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialog>
		</>
	);
}
