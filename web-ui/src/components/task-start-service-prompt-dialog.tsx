import { Button, Callout, Checkbox, Classes, Dialog, DialogBody, DialogFooter, Pre } from "@blueprintjs/core";
import type { ReactElement } from "react";

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

	return (
		<Dialog
			isOpen={open}
			onClose={onClose}
			title={prompt?.title ?? "Setup recommendation"}
			icon="info-sign"
			style={{ width: 560 }}
		>
			<DialogBody>
				<p className={Classes.TEXT_MUTED}>
					{prompt?.description}
					{learnMoreUrl ? (
						<>
							{" "}
							<a href={learnMoreUrl} target="_blank" rel="noreferrer">
								Learn more.
							</a>
						</>
					) : null}
				</p>
				{installCommand ? (
					<div style={{ marginTop: 12 }}>
						<p className={Classes.TEXT_MUTED} style={{ marginTop: 0, marginBottom: 6 }}>
							{prompt?.installCommandDescription ?? "Install command:"}
						</p>
						<Pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{installCommand}</Pre>
					</div>
				) : null}
				{prompt?.authenticationNote ? (
					<Callout intent="warning" icon="warning-sign" compact style={{ marginTop: 12 }}>
						{prompt.authenticationNote}
					</Callout>
				) : null}
			</DialogBody>
			<DialogFooter
				actions={
					<>
						<Button text="Close" onClick={onClose} />
						{installCommand && onRunInstallCommand ? (
							<Button
								intent="primary"
								text={prompt?.installButtonLabel ?? "Run command"}
								onClick={onRunInstallCommand}
							/>
						) : null}
					</>
				}
			>
				<Checkbox
					checked={doNotShowAgain}
					onChange={(event) => onDoNotShowAgainChange(event.currentTarget.checked)}
					label="Do not show again"
					style={{ margin: 0 }}
				/>
			</DialogFooter>
		</Dialog>
	);
}
