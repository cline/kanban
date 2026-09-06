import { parseRuntimeClineReasoningEffort } from "@runtime-task-agent-settings";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ClineChatModelSelector } from "@/components/detail-panels/cline-chat-model-selector";
import {
	buildClineAgentModelPickerOptions,
	buildClineSelectedModelButtonText,
	getClineReasoningEnabledModelIds,
} from "@/components/detail-panels/cline-model-picker-options";
import { SearchSelectDropdown } from "@/components/search-select-dropdown";
import { patchAgentSettings, shouldPreserveEmptyOverride } from "@/components/task-agent-settings-state";
import type { RuntimeClineProviderModel, RuntimeClineReasoningEffort, RuntimeTaskAgentSettings } from "@/runtime/types";

export function ClineTaskAgentSettingsFields({
	agentSettings,
	onAgentSettingsChange,
	providerOptions,
	modelOptions,
	effectiveDefaultModelId = null,
	providerModels = [],
	isLoadingProviders,
	isLoadingModels,
	settingsExpanded = true,
	onPopoverOpenChange,
	defaultProviderId,
	defaultReasoningEffort,
	providerDefaultModels,
}: {
	agentSettings?: RuntimeTaskAgentSettings | undefined;
	onAgentSettingsChange?: (value: RuntimeTaskAgentSettings | undefined) => void;
	providerOptions: Array<{ value: string; label: string }>;
	modelOptions: Array<{ value: string; label: string }>;
	effectiveDefaultModelId?: string | null;
	providerModels?: RuntimeClineProviderModel[];
	isLoadingProviders: boolean;
	isLoadingModels: boolean;
	settingsExpanded?: boolean;
	onPopoverOpenChange?: (open: boolean) => void;
	defaultProviderId?: string | null;
	defaultReasoningEffort?: RuntimeClineReasoningEffort | null;
	providerDefaultModels?: Record<string, string>;
}): ReactElement {
	const providerId = agentSettings?.providerId;
	const modelId = agentSettings?.modelId;
	const taskReasoningEffort = agentSettings?.reasoningEffort;

	const updateTaskAgentSettings = useCallback(
		(updater: (current: RuntimeTaskAgentSettings | undefined) => RuntimeTaskAgentSettings | undefined) => {
			onAgentSettingsChange?.(updater(agentSettings));
		},
		[agentSettings, onAgentSettingsChange],
	);

	const effectiveProviderId = providerId ?? defaultProviderId ?? null;
	const showModelPicker = Boolean(effectiveProviderId);
	const hasTaskAgentSettingsOverride = agentSettings !== undefined;
	const selectedTaskReasoningEffort = taskReasoningEffort ?? "";
	const [isProviderPopoverOpen, setIsProviderPopoverOpen] = useState(false);
	const [isModelPopoverOpen, setIsModelPopoverOpen] = useState(false);
	const [reasoningEffort, setReasoningEffort] = useState<string>(
		hasTaskAgentSettingsOverride ? selectedTaskReasoningEffort : (defaultReasoningEffort ?? ""),
	);
	const setReasoningEffortWithOverride = useCallback(
		(nextReasoningEffort: string) => {
			setReasoningEffort(nextReasoningEffort);
			updateTaskAgentSettings((currentSettings) =>
				patchAgentSettings(
					currentSettings,
					(nextSettings) => {
						if (nextReasoningEffort) {
							nextSettings.reasoningEffort = nextReasoningEffort;
						} else {
							delete nextSettings.reasoningEffort;
						}
					},
					currentSettings !== undefined || Boolean(defaultReasoningEffort),
				),
			);
		},
		[defaultReasoningEffort, updateTaskAgentSettings],
	);

	const modelPickerOptions = useMemo(() => {
		const defaultOption = modelOptions.find((option) => option.value === "");
		const explicitOptions = modelOptions.filter((option) => option.value !== "");
		const selectedProviderId = (effectiveProviderId ?? "").trim();

		if (!selectedProviderId || explicitOptions.length === 0) {
			return {
				options: defaultOption ? [defaultOption, ...explicitOptions] : explicitOptions,
				recommendedModelIds: [] as string[],
				shouldPinSelectedModelToTop: true,
			};
		}

		const orderedOptions = buildClineAgentModelPickerOptions(selectedProviderId, providerModels);
		const explicitOptionByValue = new Map(explicitOptions.map((option) => [option.value, option] as const));
		const orderedExplicit = orderedOptions.options
			.map((option) => explicitOptionByValue.get(option.value))
			.filter((option): option is { value: string; label: string } => option !== undefined);
		const orderedExplicitValueSet = new Set(orderedExplicit.map((option) => option.value));
		const remainingExplicit = explicitOptions.filter((option) => !orderedExplicitValueSet.has(option.value));

		return {
			options: defaultOption ? [defaultOption, ...orderedExplicit, ...remainingExplicit] : orderedExplicit,
			recommendedModelIds: orderedOptions.recommendedModelIds,
			shouldPinSelectedModelToTop: orderedOptions.shouldPinSelectedModelToTop,
		};
	}, [effectiveProviderId, modelOptions, providerModels]);

	const reasoningEnabledModelIds = useMemo(() => getClineReasoningEnabledModelIds(providerModels), [providerModels]);
	const reasoningEnabledModelIdSet = useMemo(() => new Set(reasoningEnabledModelIds), [reasoningEnabledModelIds]);
	const effectiveSelectedModelId = (modelId ?? effectiveDefaultModelId ?? "").trim();
	const selectedModelCapabilityKnown = useMemo(
		() => providerModels.some((model) => model.id === effectiveSelectedModelId),
		[effectiveSelectedModelId, providerModels],
	);
	const selectedModelSupportsReasoningEffort = reasoningEnabledModelIdSet.has(effectiveSelectedModelId);

	useEffect(() => {
		if (!hasTaskAgentSettingsOverride) {
			return;
		}
		if (selectedTaskReasoningEffort !== reasoningEffort) {
			setReasoningEffort(selectedTaskReasoningEffort);
		}
	}, [hasTaskAgentSettingsOverride, reasoningEffort, selectedTaskReasoningEffort]);

	useEffect(() => {
		if (hasTaskAgentSettingsOverride) {
			return;
		}
		const inheritedReasoningEffort = defaultReasoningEffort ?? "";
		if (reasoningEffort !== inheritedReasoningEffort) {
			setReasoningEffort(inheritedReasoningEffort);
		}
	}, [defaultReasoningEffort, hasTaskAgentSettingsOverride, reasoningEffort]);

	useEffect(() => {
		if (!settingsExpanded) {
			setIsProviderPopoverOpen(false);
			setIsModelPopoverOpen(false);
		}
	}, [settingsExpanded]);

	useEffect(() => {
		onPopoverOpenChange?.(isProviderPopoverOpen || isModelPopoverOpen);
	}, [isModelPopoverOpen, isProviderPopoverOpen, onPopoverOpenChange]);

	useEffect(() => {
		if (!selectedModelCapabilityKnown) {
			return;
		}
		if (!selectedModelSupportsReasoningEffort && reasoningEffort) {
			setReasoningEffortWithOverride("");
		}
	}, [
		reasoningEffort,
		selectedModelCapabilityKnown,
		selectedModelSupportsReasoningEffort,
		setReasoningEffortWithOverride,
	]);

	const selectedModelButtonText = useMemo(
		() =>
			buildClineSelectedModelButtonText({
				modelOptions: modelPickerOptions.options,
				selectedModelId: modelId ?? "",
				reasoningEffort,
				showReasoningEffort: selectedModelSupportsReasoningEffort,
				isModelLoading: isLoadingModels,
			}),
		[isLoadingModels, modelId, modelPickerOptions.options, reasoningEffort, selectedModelSupportsReasoningEffort],
	);

	return (
		<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
			<div className="min-w-0">
				<span className="text-[11px] text-text-secondary block mb-1">
					Provider{isLoadingProviders ? " (loading\u2026)" : ""}
				</span>
				<SearchSelectDropdown
					options={providerOptions}
					selectedValue={providerId ?? ""}
					onSelect={(value) => {
						const newProviderId = value || undefined;
						const newDefaultModel =
							newProviderId && providerDefaultModels ? providerDefaultModels[newProviderId] : undefined;
						updateTaskAgentSettings((currentSettings) =>
							patchAgentSettings(
								currentSettings,
								(nextSettings) => {
									if (newProviderId) {
										nextSettings.providerId = newProviderId;
									} else {
										delete nextSettings.providerId;
									}
									if (newDefaultModel) {
										nextSettings.modelId = newDefaultModel;
									} else {
										delete nextSettings.modelId;
									}
									delete nextSettings.reasoningEffort;
								},
								newProviderId !== undefined || shouldPreserveEmptyOverride(currentSettings),
							),
						);
						setReasoningEffort(
							newProviderId || shouldPreserveEmptyOverride(agentSettings) ? "" : (defaultReasoningEffort ?? ""),
						);
					}}
					disabled={isLoadingProviders}
					fill
					size="sm"
					placeholder="Search providers..."
					emptyText="No providers available"
					noResultsText="No matching providers"
					showSelectedIndicator
					onPopoverOpenChange={setIsProviderPopoverOpen}
				/>
			</div>
			{showModelPicker ? (
				<div className="min-w-0">
					<span className="text-[11px] text-text-secondary block mb-1">
						Model{isLoadingModels ? " (loading\u2026)" : ""}
					</span>
					<ClineChatModelSelector
						modelOptions={modelPickerOptions.options}
						recommendedModelIds={modelPickerOptions.recommendedModelIds}
						pinSelectedModelToTop={modelPickerOptions.shouldPinSelectedModelToTop}
						selectedModelId={modelId ?? ""}
						selectedModelButtonText={selectedModelButtonText}
						onSelectModel={(value) => {
							updateTaskAgentSettings((currentSettings) =>
								patchAgentSettings(currentSettings, (nextSettings) => {
									if (value) {
										nextSettings.modelId = value;
									} else {
										delete nextSettings.modelId;
									}
									if (!value || !reasoningEnabledModelIdSet.has(value)) {
										delete nextSettings.reasoningEffort;
									}
								}),
							);
							if (!value && !providerId) {
								setReasoningEffort(
									shouldPreserveEmptyOverride(agentSettings) ? "" : (defaultReasoningEffort ?? ""),
								);
								return;
							}
							if (!value || !reasoningEnabledModelIdSet.has(value)) {
								setReasoningEffortWithOverride("");
							}
						}}
						reasoningEnabledModelIds={reasoningEnabledModelIds}
						defaultOptionSupportsReasoningEffort={!modelId && selectedModelSupportsReasoningEffort}
						selectedReasoningEffort={parseRuntimeClineReasoningEffort(reasoningEffort) ?? ""}
						onSelectReasoningEffort={(nextReasoningEffort) => setReasoningEffortWithOverride(nextReasoningEffort)}
						disabled={isLoadingModels}
						isModelLoading={isLoadingModels}
						fill
						triggerVariant="default"
						onPopoverOpenChange={setIsModelPopoverOpen}
					/>
				</div>
			) : null}
		</div>
	);
}
