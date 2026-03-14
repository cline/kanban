import * as RadixAlertDialog from "@radix-ui/react-alert-dialog";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/components/ui/cn";

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

export function Dialog({
	open,
	onOpenChange,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: ReactNode;
}): React.ReactElement {
	return (
		<RadixDialog.Root open={open} onOpenChange={onOpenChange}>
			<RadixDialog.Portal>
				<RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/60" style={{ animation: "kb-overlay-show 150ms ease" }} />
				<RadixDialog.Content
					className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-lg max-h-[85vh] flex flex-col rounded-lg border border-border bg-surface-1 shadow-2xl focus:outline-none"
					style={{ animation: "kb-dialog-show 150ms ease", transform: "translate(-50%, -50%)" }}
				>
					{children}
				</RadixDialog.Content>
			</RadixDialog.Portal>
		</RadixDialog.Root>
	);
}

export function DialogHeader({ title, icon, children }: { title: string; icon?: ReactNode; children?: ReactNode }): React.ReactElement {
	return (
		<div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-2 shrink-0 rounded-t-lg">
			<RadixDialog.Title className="flex items-center gap-2 text-sm font-semibold text-text-primary">
				{icon ? <span className="text-text-secondary">{icon}</span> : null}
				{title}
			</RadixDialog.Title>
			{children}
			<RadixDialog.Close className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-3 cursor-pointer">
				<X size={16} />
			</RadixDialog.Close>
		</div>
	);
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }): React.ReactElement {
	return <div className={cn("p-5 overflow-y-auto flex-1 min-h-0", className)}>{children}</div>;
}

export function DialogFooter({ children }: { children: ReactNode }): React.ReactElement {
	return <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-surface-2 shrink-0 rounded-b-lg">{children}</div>;
}

/* ------------------------------------------------------------------ */
/* AlertDialog (for destructive confirmations)                         */
/* ------------------------------------------------------------------ */

export function AlertDialog({
	open,
	onOpenChange,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: ReactNode;
}): React.ReactElement {
	return (
		<RadixAlertDialog.Root open={open} onOpenChange={onOpenChange}>
			<RadixAlertDialog.Portal>
				<RadixAlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60" style={{ animation: "kb-overlay-show 150ms ease" }} />
				<RadixAlertDialog.Content
					className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-md rounded-lg border border-border bg-surface-1 p-5 shadow-2xl focus:outline-none"
					style={{ animation: "kb-dialog-show 150ms ease", transform: "translate(-50%, -50%)" }}
				>
					{children}
				</RadixAlertDialog.Content>
			</RadixAlertDialog.Portal>
		</RadixAlertDialog.Root>
	);
}

export const AlertDialogTitle = RadixAlertDialog.Title;
export const AlertDialogDescription = RadixAlertDialog.Description;
export const AlertDialogAction = RadixAlertDialog.Action;
export const AlertDialogCancel = RadixAlertDialog.Cancel;
