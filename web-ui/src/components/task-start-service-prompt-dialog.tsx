import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Circle, CircleDot } from "lucide-react";
import { useCallback, useEffect, useState, type ReactElement } from "react";

import {
	TaskStartAgentOnboardingCarousel,
	TASK_START_ONBOARDING_SLIDES,
} from "@/components/task-start-agent-onboarding-carousel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import type { TaskStartServicePromptContent } from "@/hooks/use-task-start-service-prompts";
import type {
	RuntimeAgentDefinition,
	RuntimeAgentId,
	RuntimeClineProviderSettings,
	RuntimeConfigResponse,
} from "@/runtime/types";

export function TaskStartServicePromptDialog({
	open,
	prompt,
	doNotShowAgain,
	onDoNotShowAgainChange,
	onClose,
	onRunInstallCommand,
	selectedAgentId,
	agents,
	clineProviderSettings,
	onSelectAgent,
	workspaceId,
	runtimeConfig,
	onClineSetupSaved,
}: {
	open: boolean;
	prompt: TaskStartServicePromptContent | null;
	doNotShowAgain: boolean;
	onDoNotShowAgainChange: (value: boolean) => void;
	onClose: () => void;
	onRunInstallCommand?: () => void;
	selectedAgentId?: RuntimeAgentId | null;
	agents?: RuntimeAgentDefinition[];
	clineProviderSettings?: RuntimeClineProviderSettings | null;
	onSelectAgent?: (agentId: RuntimeAgentId) => Promise<{ ok: boolean; message?: string }>;
	workspaceId?: string | null;
	runtimeConfig?: RuntimeConfigResponse | null;
	onClineSetupSaved?: () => void;
}): ReactElement {
	const installCommand = prompt?.installCommand ?? null;
	const learnMoreUrl = prompt?.learnMoreUrl ?? null;
	const doNotShowAgainCheckboxId = "task-start-service-prompt-do-not-show-again";
	const isAgentOnboardingPrompt = prompt?.id === "agent_cli";
	const [onboardingSlideIndex, setOnboardingSlideIndex] = useState(0);
	const [isCompletingOnboarding, setIsCompletingOnboarding] = useState(false);
	const [onboardingDoneAction, setOnboardingDoneAction] = useState<(() => Promise<{ ok: boolean; message?: string }>) | null>(null);
	const onboardingSlideCount = TASK_START_ONBOARDING_SLIDES.length;
	const isFirstOnboardingSlide = onboardingSlideIndex === 0;
	const isLastOnboardingSlide = onboardingSlideIndex === onboardingSlideCount - 1;

	useEffect(() => {
		if (!open || !isAgentOnboardingPrompt) {
			return;
		}
		setOnboardingSlideIndex(0);
		setIsCompletingOnboarding(false);
		setOnboardingDoneAction(null);
	}, [isAgentOnboardingPrompt, open]);

	const handleOnboardingDoneActionChange = useCallback(
		(action: (() => Promise<{ ok: boolean; message?: string }>) | null) => {
			setOnboardingDoneAction(() => action);
		},
		[],
	);

	const handleAdvanceOnboarding = useCallback(() => {
		if (!isLastOnboardingSlide) {
			setOnboardingSlideIndex((current) => Math.min(current + 1, onboardingSlideCount - 1));
			return;
		}
		void (async () => {
			setIsCompletingOnboarding(true);
			try {
				const result = onboardingDoneAction ? await onboardingDoneAction() : { ok: true };
				if (result.ok) {
					onClose();
				}
			} finally {
				setIsCompletingOnboarding(false);
			}
		})();
	}, [isLastOnboardingSlide, onboardingDoneAction, onClose, onboardingSlideCount]);

	return (
		<Dialog
			open={open}
			onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}
		>
			<DialogHeader title={prompt?.title ?? "Setup recommendation"} />
			<DialogBody>
				{isAgentOnboardingPrompt ? (
					<TaskStartAgentOnboardingCarousel
						open={open}
						workspaceId={workspaceId ?? null}
						runtimeConfig={runtimeConfig ?? null}
						selectedAgentId={selectedAgentId ?? null}
						agents={agents ?? []}
						clineProviderSettings={clineProviderSettings ?? null}
						activeSlideIndex={onboardingSlideIndex}
						onSelectAgent={onSelectAgent}
						onClineSetupSaved={onClineSetupSaved}
						onDoneActionChange={handleOnboardingDoneActionChange}
					/>
				) : (
					<>
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
					</>
				)}
			</DialogBody>
			<DialogFooter>
				{isAgentOnboardingPrompt ? (
					<>
						<Button
							size="sm"
							onClick={() => setOnboardingSlideIndex((current) => Math.max(current - 1, 0))}
							disabled={isFirstOnboardingSlide || isCompletingOnboarding}
						>
							<ChevronLeft size={14} />
							Back
						</Button>
						<div className="mx-auto flex items-center gap-1">
							{TASK_START_ONBOARDING_SLIDES.map((_, index) =>
								index === onboardingSlideIndex ? (
									<CircleDot key={index} size={14} className="text-accent" />
								) : (
									<button
										key={index}
										type="button"
										onClick={() => setOnboardingSlideIndex(index)}
										className="text-text-tertiary hover:text-text-secondary"
										aria-label={`Go to onboarding slide ${index + 1}`}
									>
										<Circle size={14} />
									</button>
								),
							)}
						</div>
						<Button size="sm" variant="primary" onClick={handleAdvanceOnboarding} disabled={isCompletingOnboarding}>
							{isLastOnboardingSlide ? "Done" : "Next"}
							{isLastOnboardingSlide ? null : <ChevronRight size={14} />}
						</Button>
					</>
				) : (
					<label htmlFor={doNotShowAgainCheckboxId} className="flex items-center gap-2 text-[13px] text-text-primary mr-auto cursor-pointer">
						<RadixCheckbox.Root
							id={doNotShowAgainCheckboxId}
							aria-label="Do not show service setup prompt again"
							checked={doNotShowAgain}
							onCheckedChange={(checked) => onDoNotShowAgainChange(checked === true)}
							className="flex h-4 w-4 items-center justify-center rounded border border-border-bright bg-surface-1 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
						>
							<RadixCheckbox.Indicator>
								<Check size={12} className="text-white" />
							</RadixCheckbox.Indicator>
						</RadixCheckbox.Root>
						<span>Do not show again</span>
					</label>
				)}
				{!isAgentOnboardingPrompt ? <Button onClick={onClose}>Close</Button> : null}
				{!isAgentOnboardingPrompt && installCommand && onRunInstallCommand ? (
					<Button variant="primary" onClick={onRunInstallCommand}>
						{prompt?.installButtonLabel ?? "Run command"}
					</Button>
				) : null}
			</DialogFooter>
		</Dialog>
	);
}
