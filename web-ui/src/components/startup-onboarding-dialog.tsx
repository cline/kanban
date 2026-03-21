import { ChevronLeft, ChevronRight, Circle, CircleDot } from "lucide-react";
import { useCallback, useEffect, useState, type ReactElement } from "react";

import {
	TaskStartAgentOnboardingCarousel,
	TASK_START_ONBOARDING_SLIDES,
} from "@/components/task-start-agent-onboarding-carousel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import type {
	RuntimeAgentDefinition,
	RuntimeAgentId,
	RuntimeClineProviderSettings,
	RuntimeConfigResponse,
} from "@/runtime/types";

export function StartupOnboardingDialog({
	open,
	onClose,
	selectedAgentId,
	agents,
	clineProviderSettings,
	onSelectAgent,
	workspaceId,
	runtimeConfig,
	onClineSetupSaved,
}: {
	open: boolean;
	onClose: () => void;
	selectedAgentId?: RuntimeAgentId | null;
	agents?: RuntimeAgentDefinition[];
	clineProviderSettings?: RuntimeClineProviderSettings | null;
	onSelectAgent?: (agentId: RuntimeAgentId) => Promise<{ ok: boolean; message?: string }>;
	workspaceId?: string | null;
	runtimeConfig?: RuntimeConfigResponse | null;
	onClineSetupSaved?: () => void;
}): ReactElement {
	const [onboardingSlideIndex, setOnboardingSlideIndex] = useState(0);
	const [isCompletingOnboarding, setIsCompletingOnboarding] = useState(false);
	const [onboardingDoneAction, setOnboardingDoneAction] = useState<(() => Promise<{ ok: boolean; message?: string }>) | null>(null);
	const onboardingSlideCount = TASK_START_ONBOARDING_SLIDES.length;
	const isFirstOnboardingSlide = onboardingSlideIndex === 0;
	const isLastOnboardingSlide = onboardingSlideIndex === onboardingSlideCount - 1;

	useEffect(() => {
		if (!open) {
			return;
		}
		setOnboardingSlideIndex(0);
		setIsCompletingOnboarding(false);
		setOnboardingDoneAction(null);
	}, [open]);

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
			<DialogHeader title="Get started" />
			<DialogBody>
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
			</DialogBody>
			<DialogFooter>
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
			</DialogFooter>
		</Dialog>
	);
}
