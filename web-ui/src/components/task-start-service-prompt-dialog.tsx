import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { AlertTriangle, Check } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import type { TaskStartServicePromptContent } from "@/hooks/use-task-start-service-prompts";

export function TaskStartServicePromptDialog({
	open,
	prompt,
	doNotShowAgain,
	onDoNotShowAgainChange,
	onClose,
	onRunInstallCommand,
}: {
	open: boolean;
	prompt: TaskStartServicePromptContent | null;
	doNotShowAgain: boolean;
	onDoNotShowAgainChange: (value: boolean) => void;
	onClose: () => void;
	onRunInstallCommand?: () => void;
}): ReactElement {
	const installCommand = prompt?.installCommand ?? null;
	const learnMoreUrl = prompt?.learnMoreUrl ?? null;
	const doNotShowAgainCheckboxId = "task-start-service-prompt-do-not-show-again";

	return (
		<Dialog
			open={open}
			onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}
		>
			<DialogHeader title={prompt?.title ?? "Setup recommendation"} />
			<DialogBody>
				<p className="text-text-secondary text-[13px]">
					{prompt?.description}
					{learnMoreUrl ? (
						<>
							{" "}
							<a href={learnMoreUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
								Learn more.
							</a>
						</>
					) : null}
				</p>
				{installCommand ? (
					<div className="mt-3">
						<p className="text-text-secondary text-[13px] mb-1.5">
							{prompt?.installCommandDescription ?? "Install command:"}
						</p>
						<pre className="rounded-md bg-surface-0 p-3 font-mono text-xs text-text-secondary whitespace-pre-wrap overflow-auto">
							{installCommand}
						</pre>
					</div>
				) : null}
				{prompt?.authenticationNote ? (
					<div className="flex gap-2 rounded-md border border-status-orange/30 bg-status-orange/5 p-3 text-[13px] mt-3">
						<AlertTriangle size={16} className="text-status-orange shrink-0 mt-0.5" />
						<span className="text-text-primary">{prompt.authenticationNote}</span>
					</div>
				) : null}
			</DialogBody>
			<DialogFooter>
				<label htmlFor={doNotShowAgainCheckboxId} className="flex items-center gap-2 text-[13px] text-text-primary mr-auto cursor-pointer">
					<RadixCheckbox.Root
						id={doNotShowAgainCheckboxId}
						aria-label="Do not show service setup prompt again"
						checked={doNotShowAgain}
						onCheckedChange={(checked) => onDoNotShowAgainChange(checked === true)}
						className="flex h-4 w-4 items-center justify-center rounded border border-border bg-surface-2 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
					>
						<RadixCheckbox.Indicator>
							<Check size={12} className="text-white" />
						</RadixCheckbox.Indicator>
					</RadixCheckbox.Root>
					<span>Do not show again</span>
				</label>
				<Button onClick={onClose}>Close</Button>
				{installCommand && onRunInstallCommand ? (
					<Button variant="primary" onClick={onRunInstallCommand}>
						{prompt?.installButtonLabel ?? "Run command"}
					</Button>
				) : null}
			</DialogFooter>
		</Dialog>
	);
}
