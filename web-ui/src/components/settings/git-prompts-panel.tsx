import { type ReactElement, useRef, useState } from "react";

import { SettingSection } from "@/components/settings/setting-section";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { TASK_GIT_BASE_REF_PROMPT_VARIABLE, type TaskGitAction } from "@/git-actions/build-task-git-action-prompt";
import { useUnmount } from "@/utils/react-use";

const GIT_PROMPT_VARIANT_OPTIONS: Array<{ value: TaskGitAction; label: string; description: string }> = [
	{ value: "commit", label: "Commit", description: "Prompt sent when using the Commit button on review tasks." },
	{ value: "pr", label: "Make PR", description: "Prompt sent when using the Make PR button on review tasks." },
];

export function GitPromptsPanel({
	commitPromptTemplate,
	openPrPromptTemplate,
	commitPromptTemplateDefault,
	openPrPromptTemplateDefault,
	onCommitPromptChange,
	onOpenPrPromptChange,
	controlsDisabled,
}: {
	commitPromptTemplate: string;
	openPrPromptTemplate: string;
	commitPromptTemplateDefault: string;
	openPrPromptTemplateDefault: string;
	onCommitPromptChange: (value: string) => void;
	onOpenPrPromptChange: (value: string) => void;
	controlsDisabled: boolean;
}): ReactElement {
	const [selectedVariant, setSelectedVariant] = useState<TaskGitAction>("commit");
	const [copiedToken, setCopiedToken] = useState<string | null>(null);
	const copiedResetTimerRef = useRef<number | null>(null);

	useUnmount(() => {
		if (copiedResetTimerRef.current !== null) {
			window.clearTimeout(copiedResetTimerRef.current);
		}
	});

	const selectedPromptValue = selectedVariant === "commit" ? commitPromptTemplate : openPrPromptTemplate;
	const selectedPromptDefault =
		selectedVariant === "commit" ? commitPromptTemplateDefault : openPrPromptTemplateDefault;
	const isAtDefault =
		selectedPromptValue.replaceAll("\r\n", "\n").trim() === selectedPromptDefault.replaceAll("\r\n", "\n").trim();
	const selectedOption = GIT_PROMPT_VARIANT_OPTIONS.find((o) => o.value === selectedVariant);

	const handleChange = (value: string) => {
		if (selectedVariant === "commit") {
			onCommitPromptChange(value);
		} else {
			onOpenPrPromptChange(value);
		}
	};

	const handleReset = () => {
		handleChange(selectedPromptDefault);
	};

	const handleCopyToken = (token: string) => {
		void (async () => {
			try {
				await navigator.clipboard.writeText(token);
				setCopiedToken(token);
				if (copiedResetTimerRef.current !== null) {
					window.clearTimeout(copiedResetTimerRef.current);
				}
				copiedResetTimerRef.current = window.setTimeout(() => {
					setCopiedToken((current) => (current === token ? null : current));
					copiedResetTimerRef.current = null;
				}, 2000);
			} catch {
				// Ignore clipboard failures.
			}
		})();
	};

	return (
		<div>
			<div className="sticky top-[-20px] -mx-5 px-5 -mt-5 pt-5 pb-3 mb-4 bg-surface-1 z-10">
				<h2 className="text-base font-semibold text-text-primary m-0 mb-1">Git Prompts</h2>
				<p className="text-[12px] text-text-secondary m-0">
					Customize the prompts sent to the agent when using git actions on review tasks.
				</p>
			</div>

			<SettingSection title="Prompt template">
				<div className="px-4 py-3">
					{/* Pill buttons + Reset to default */}
					<div className="flex items-center justify-between">
						<div className="flex gap-2">
							{GIT_PROMPT_VARIANT_OPTIONS.map((option) => (
								<button
									key={option.value}
									type="button"
									onClick={() => setSelectedVariant(option.value)}
									disabled={controlsDisabled}
									className={cn(
										"h-8 px-3 rounded-md text-[13px] font-medium transition-colors cursor-pointer border disabled:opacity-40",
										selectedVariant === option.value
											? "bg-surface-3 border-border-bright text-text-primary"
											: "bg-transparent border-border text-text-secondary hover:text-text-primary hover:border-border-bright",
									)}
								>
									{option.label}
								</button>
							))}
						</div>
						<Button variant="default" size="sm" onClick={handleReset} disabled={controlsDisabled || isAtDefault}>
							Reset to default
						</Button>
					</div>

					{/* Separator */}
					<div className="border-b border-border my-3" />

					{/* Description for selected variant */}
					{selectedOption ? (
						<p className="text-text-secondary text-[12px] m-0 mb-3">{selectedOption.description}</p>
					) : null}

					{/* Helper text */}
					<p className="text-text-tertiary text-[12px] m-0 mb-2">Edit the prompt template below.</p>

					{/* Textarea — fixed height, scrollable */}
					<textarea
						value={selectedPromptValue}
						onChange={(event) => handleChange(event.target.value)}
						placeholder={selectedVariant === "commit" ? "Commit prompt template" : "PR prompt template"}
						disabled={controlsDisabled}
						className="w-full h-[200px] rounded-lg border border-border bg-surface-2 p-3 text-[13px] text-text-primary font-mono placeholder:text-text-tertiary focus:border-border-focus focus:outline-none resize-none disabled:opacity-40 leading-relaxed overflow-y-auto"
					/>
				</div>
			</SettingSection>

			<SettingSection title="Variables">
				<div className="px-4 py-3">
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => handleCopyToken(TASK_GIT_BASE_REF_PROMPT_VARIABLE.token)}
							disabled={controlsDisabled}
							className="inline-flex items-center h-6 px-2 rounded bg-surface-3 border border-border text-[11px] font-mono text-text-primary hover:bg-surface-4 cursor-pointer transition-colors disabled:opacity-40"
						>
							{copiedToken === TASK_GIT_BASE_REF_PROMPT_VARIABLE.token
								? "Copied!"
								: TASK_GIT_BASE_REF_PROMPT_VARIABLE.token}
						</button>
						<span className="text-text-secondary text-[12px]">
							{TASK_GIT_BASE_REF_PROMPT_VARIABLE.description}
						</span>
					</div>
				</div>
			</SettingSection>
		</div>
	);
}
