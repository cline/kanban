import * as Collapsible from "@radix-ui/react-collapsible";
import { getRuntimeLaunchSupportedAgentCatalog } from "@runtime-agent-catalog";
import { ChevronDown } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ClineChatModelSelector } from "@/components/detail-panels/cline-chat-model-selector";
import {
	buildClineAgentModelPickerOptions,
	buildClineSelectedModelButtonText,
	getClineReasoningEnabledModelIds,
} from "@/components/detail-panels/cline-model-picker-options";
import { SearchSelectDropdown } from "@/components/search-select-dropdown";
import { cn } from "@/components/ui/cn";
import { NativeSelect } from "@/components/ui/native-select";
import { fetchClineProviderCatalog, fetchClineProviderModels } from "@/runtime/runtime-config-query";
import type {
	RuntimeAgentId,
	RuntimeClineProviderCatalogItem,
	RuntimeClineProviderModel,
	RuntimeClineReasoningEffort,
	RuntimeTaskClineSettings,
} from "@/runtime/types";

// ---------------------------------------------------------------------------
// Hook: manages fetch state for Cline provider catalog + model lists
// ---------------------------------------------------------------------------

export interface UseTaskAgentModelPickerInput {
	active: boolean;
	workspaceId: string | null;
	agentId: RuntimeAgentId | undefined;
	clineSettings?: RuntimeTaskClineSettings;
	/** The default agent ID from runtimeConfig.selectedAgentId — used to build the first option label */
	defaultAgentId?: RuntimeAgentId | null;
	/** The default Cline provider ID from runtimeConfig.clineProviderSettings.providerId */
	defaultProviderId?: string | null;
	/** The default Cline model ID from runtimeConfig.clineProviderSettings.modelId */
	defaultModelId?: string | null;
}

export interface UseTaskAgentModelPickerResult {
	agentOptions: Array<{ value: string; label: string }>;
	clineProviderOptions: Array<{ value: string; label: string }>;
	clineModelOptions: Array<{ value: string; label: string }>;
	effectiveDefaultModelId: string | null;
	providerModels: RuntimeClineProviderModel[];
	isLoadingProviders: boolean;
	isLoadingModels: boolean;
	/** Map of provider ID → its default model ID (from the provider catalog). */
	providerDefaultModels: Record<string, string>;
}

export function useTaskAgentModelPicker({
	active,
	workspaceId,
	agentId,
	clineSettings,
	defaultAgentId,
	defaultProviderId,
	defaultModelId,
}: UseTaskAgentModelPickerInput): UseTaskAgentModelPickerResult {
	const [providerCatalog, setProviderCatalog] = useState<RuntimeClineProviderCatalogItem[]>([]);
	const [providerModels, setProviderModels] = useState<RuntimeClineProviderModel[]>([]);
	const [isLoadingProviders, setIsLoadingProviders] = useState(false);
	const [isLoadingModels, setIsLoadingModels] = useState(false);

	// Derive the effective agent: explicit override takes precedence, then the global default
	const effectiveAgentId = agentId ?? defaultAgentId ?? null;

	useEffect(() => {
		if (!active || effectiveAgentId !== "cline") {
			return;
		}
		let cancelled = false;
		setIsLoadingProviders(true);
		void fetchClineProviderCatalog(workspaceId)
			.then((catalog) => {
				if (!cancelled) {
					setProviderCatalog(catalog);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setProviderCatalog([]);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingProviders(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [active, effectiveAgentId, workspaceId]);

	// Derive the effective provider: explicit override takes precedence, then the global default
	const clineProviderId = clineSettings?.providerId;
	const effectiveProviderId = (clineProviderId ?? defaultProviderId ?? "").trim() || null;

	useEffect(() => {
		if (!active || effectiveAgentId !== "cline" || !effectiveProviderId) {
			setProviderModels([]);
			return;
		}
		let cancelled = false;
		setIsLoadingModels(true);
		void fetchClineProviderModels(workspaceId, effectiveProviderId)
			.then((models) => {
				if (!cancelled) {
					setProviderModels(models);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setProviderModels([]);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingModels(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [active, effectiveAgentId, effectiveProviderId, workspaceId]);

	const agentOptions = useMemo(() => {
		const catalog = getRuntimeLaunchSupportedAgentCatalog();
		let firstLabel = "Default";
		if (defaultAgentId) {
			const defaultAgent = catalog.find((a) => a.id === defaultAgentId);
			if (defaultAgent) {
				firstLabel = defaultAgent.label;
			}
		}
		return [
			{ value: "", label: firstLabel },
			// Exclude the default agent from the explicit list — it's already represented by the first option
			...catalog
				.filter((agent) => agent.id !== defaultAgentId)
				.map((agent) => ({ value: agent.id, label: agent.label })),
		];
	}, [defaultAgentId]);

	const clineProviderOptions = useMemo(() => {
		let firstLabel = "Default";
		if (defaultProviderId) {
			const defaultProvider = providerCatalog.find((p) => p.id === defaultProviderId);
			firstLabel = defaultProvider ? defaultProvider.name : defaultProviderId;
		}
		return [
			{ value: "", label: firstLabel },
			// Exclude the default provider from the explicit list — it's already represented by the first option
			...providerCatalog.filter((p) => p.id !== defaultProviderId).map((p) => ({ value: p.id, label: p.name })),
		];
	}, [providerCatalog, defaultProviderId]);

	// Map of provider ID → its catalog default model ID. Used by the component to
	// auto-select the right model when the user switches providers.
	const providerDefaultModels = useMemo(() => {
		const map: Record<string, string> = {};
		for (const p of providerCatalog) {
			if (p.defaultModelId) {
				map[p.id] = p.defaultModelId;
			}
		}
		return map;
	}, [providerCatalog]);

	// When an explicit provider override is selected, the "Default" model label should
	// reflect that provider's default model — not the global settings model.
	const effectiveDefaultModelId = useMemo(() => {
		if (clineProviderId) {
			const provider = providerCatalog.find((p) => p.id === clineProviderId);
			return provider?.defaultModelId ?? null;
		}
		const inheritedProviderDefaultModelId =
			providerCatalog.find((p) => p.id === defaultProviderId)?.defaultModelId ?? null;
		return defaultModelId ?? inheritedProviderDefaultModelId;
	}, [clineProviderId, defaultModelId, defaultProviderId, providerCatalog]);

	const clineModelOptions = useMemo(() => {
		let defaultLabel = "Default";
		if (effectiveDefaultModelId) {
			const defaultModel = providerModels.find((m) => m.id === effectiveDefaultModelId);
			defaultLabel = defaultModel ? defaultModel.name : effectiveDefaultModelId;
		}
		return [
			{ value: "", label: defaultLabel },
			// Exclude the default model from the explicit list — it's already represented by the first option
			...providerModels.filter((m) => m.id !== effectiveDefaultModelId).map((m) => ({ value: m.id, label: m.name })),
		];
	}, [providerModels, effectiveDefaultModelId]);

	return {
		agentOptions,
		clineProviderOptions,
		clineModelOptions,
		effectiveDefaultModelId,
		providerModels,
		isLoadingProviders,
		isLoadingModels,
		providerDefaultModels,
	};
}

function cloneTaskClineSettings(settings?: RuntimeTaskClineSettings): RuntimeTaskClineSettings | undefined {
	if (settings === undefined) {
		return undefined;
	}
	const providerId = settings.providerId?.trim();
	const modelId = settings.modelId?.trim();
	return {
		...(providerId ? { providerId } : {}),
		...(modelId ? { modelId } : {}),
		...(settings.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}),
	};
}

// ---------------------------------------------------------------------------
// Component: renders Agent, Cline provider, and Cline model pickers
// ---------------------------------------------------------------------------

export function TaskAgentModelPicker({
	agentId,
	onAgentIdChange,
	clineSettings,
	onClineSettingsChange,
	agentOptions,
	clineProviderOptions,
	clineModelOptions,
	effectiveDefaultModelId = null,
	providerModels = [],
	isLoadingProviders,
	isLoadingModels,
	onPopoverOpenChange,
	defaultAgentId,
	defaultProviderId,
	defaultReasoningEffort,
	providerDefaultModels,
}: {
	agentId: RuntimeAgentId | undefined;
	onAgentIdChange: (value: RuntimeAgentId | undefined) => void;
	clineSettings?: RuntimeTaskClineSettings | undefined;
	onClineSettingsChange?: (value: RuntimeTaskClineSettings | undefined) => void;
	agentOptions: Array<{ value: string; label: string }>;
	clineProviderOptions: Array<{ value: string; label: string }>;
	clineModelOptions: Array<{ value: string; label: string }>;
	effectiveDefaultModelId?: string | null;
	providerModels?: RuntimeClineProviderModel[];
	isLoadingProviders: boolean;
	isLoadingModels: boolean;
	onPopoverOpenChange?: (open: boolean) => void;
	/** The default agent ID from runtimeConfig — used to decide if Cline pickers should show by default */
	defaultAgentId?: RuntimeAgentId | null;
	/** The default Cline provider ID from runtimeConfig — used to decide if model picker should show by default */
	defaultProviderId?: string | null;
	/** The global default reasoning effort from runtimeConfig.clineProviderSettings.reasoningEffort */
	defaultReasoningEffort?: RuntimeClineReasoningEffort | null;
	/** Map of provider ID → its default model ID (from the provider catalog). */
	providerDefaultModels?: Record<string, string>;
}): ReactElement {
	const clineProviderId = clineSettings?.providerId;
	const clineModelId = clineSettings?.modelId;
	const clineReasoningEffort = clineSettings?.reasoningEffort;

	const updateTaskClineSettings = useCallback(
		(updater: (current: RuntimeTaskClineSettings | undefined) => RuntimeTaskClineSettings | undefined) => {
			onClineSettingsChange?.(updater(cloneTaskClineSettings(clineSettings)));
		},
		[clineSettings, onClineSettingsChange],
	);

	// Show the Cline provider picker when the effective agent is "cline"
	// (either explicitly overridden to cline, or defaulting to cline)
	const effectiveAgentId = agentId ?? defaultAgentId ?? null;
	const showClineProviderPicker = effectiveAgentId === "cline";

	// Show the Cline model picker when a provider is effectively selected
	// (either explicitly overridden, or the global default provider is set)
	const effectiveProviderId = clineProviderId ?? defaultProviderId ?? null;
	const showClineModelPicker = showClineProviderPicker && Boolean(effectiveProviderId);
	const hasTaskClineSettingsOverride = clineSettings !== undefined;
	const selectedTaskReasoningEffort = clineReasoningEffort ?? "";
	const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);
	const [isProviderPopoverOpen, setIsProviderPopoverOpen] = useState(false);
	const [isModelPopoverOpen, setIsModelPopoverOpen] = useState(false);
	const [reasoningEffort, setReasoningEffort] = useState<RuntimeClineReasoningEffort | "">(
		hasTaskClineSettingsOverride ? selectedTaskReasoningEffort : (defaultReasoningEffort ?? ""),
	);
	const setReasoningEffortWithOverride = useCallback(
		(nextReasoningEffort: RuntimeClineReasoningEffort | "") => {
			setReasoningEffort(nextReasoningEffort);
			updateTaskClineSettings((currentSettings) => {
				const nextSettings = cloneTaskClineSettings(currentSettings) ?? {};
				if (nextReasoningEffort) {
					nextSettings.reasoningEffort = nextReasoningEffort;
					return nextSettings;
				}
				delete nextSettings.reasoningEffort;
				if (
					nextSettings.providerId ||
					nextSettings.modelId ||
					currentSettings !== undefined ||
					Boolean(defaultReasoningEffort)
				) {
					return nextSettings;
				}
				return undefined;
			});
		},
		[defaultReasoningEffort, updateTaskClineSettings],
	);

	const modelPickerOptions = useMemo(() => {
		const defaultOption = clineModelOptions.find((option) => option.value === "");
		const explicitOptions = clineModelOptions.filter((option) => option.value !== "");
		const providerId = (effectiveProviderId ?? "").trim();

		if (!providerId || explicitOptions.length === 0) {
			return {
				options: defaultOption ? [defaultOption, ...explicitOptions] : explicitOptions,
				recommendedModelIds: [] as string[],
				shouldPinSelectedModelToTop: true,
			};
		}

		const orderedOptions = buildClineAgentModelPickerOptions(providerId, providerModels);
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
	}, [clineModelOptions, effectiveProviderId, providerModels]);

	const reasoningEnabledModelIds = useMemo(() => getClineReasoningEnabledModelIds(providerModels), [providerModels]);
	const reasoningEnabledModelIdSet = useMemo(() => new Set(reasoningEnabledModelIds), [reasoningEnabledModelIds]);
	const effectiveSelectedModelId = (clineModelId ?? effectiveDefaultModelId ?? "").trim();
	const selectedModelCapabilityKnown = useMemo(
		() => providerModels.some((model) => model.id === effectiveSelectedModelId),
		[effectiveSelectedModelId, providerModels],
	);
	const selectedModelSupportsReasoningEffort = reasoningEnabledModelIdSet.has(effectiveSelectedModelId);

	useEffect(() => {
		if (!hasTaskClineSettingsOverride) {
			return;
		}
		if (selectedTaskReasoningEffort !== reasoningEffort) {
			setReasoningEffort(selectedTaskReasoningEffort);
		}
	}, [hasTaskClineSettingsOverride, reasoningEffort, selectedTaskReasoningEffort]);

	useEffect(() => {
		if (hasTaskClineSettingsOverride) {
			return;
		}
		const inheritedReasoningEffort = defaultReasoningEffort ?? "";
		if (reasoningEffort !== inheritedReasoningEffort) {
			setReasoningEffort(inheritedReasoningEffort);
		}
	}, [defaultReasoningEffort, hasTaskClineSettingsOverride, reasoningEffort]);

	useEffect(() => {
		if (!isSettingsExpanded) {
			setIsProviderPopoverOpen(false);
			setIsModelPopoverOpen(false);
		}
	}, [isSettingsExpanded]);

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
				selectedModelId: clineModelId ?? "",
				reasoningEffort,
				showReasoningEffort: selectedModelSupportsReasoningEffort,
				isModelLoading: isLoadingModels,
			}),
		[
			clineModelId,
			isLoadingModels,
			modelPickerOptions.options,
			reasoningEffort,
			selectedModelSupportsReasoningEffort,
		],
	);

	// When models finish loading and the currently selected model isn't in the
	// options list, auto-select the first real model so the button never shows
	// "No models available". Pick the first non-empty option (skipping the
	// "Default" placeholder) so the user immediately sees a concrete model name.
	//
	// Guard: also skip when model options only contains the "Default"
	// placeholder (length <= 1). This prevents a race condition where the
	// effect fires on the initial render before models have been fetched —
	// at that point isLoadingModels is still false (hasn't been set to true
	// yet by the fetch effect) and the stale/empty options list would
	// incorrectly clear a valid saved clineModelId.
	useEffect(() => {
		if (isLoadingModels || !clineModelId || modelPickerOptions.options.length <= 1) {
			return;
		}
		const modelExists = modelPickerOptions.options.some((opt) => opt.value === clineModelId);
		if (!modelExists) {
			const firstRealModel = modelPickerOptions.options.find((opt) => opt.value !== "");
			updateTaskClineSettings((currentSettings) => {
				const nextSettings = cloneTaskClineSettings(currentSettings) ?? {};
				if (firstRealModel?.value) {
					nextSettings.modelId = firstRealModel.value;
					return nextSettings;
				}
				delete nextSettings.modelId;
				const preserveEmptyOverride = currentSettings !== undefined && Object.keys(currentSettings).length === 0;
				return nextSettings.providerId || nextSettings.reasoningEffort || preserveEmptyOverride
					? nextSettings
					: undefined;
			});
		}
	}, [clineModelId, isLoadingModels, modelPickerOptions.options, updateTaskClineSettings]);

	return (
		<div className="flex flex-col gap-2">
			<Collapsible.Root open={isSettingsExpanded} onOpenChange={setIsSettingsExpanded}>
				<Collapsible.Trigger asChild>
					<button
						type="button"
						className="inline-flex w-fit items-center gap-1 text-[12px] text-text-secondary hover:text-text-primary cursor-pointer bg-transparent border-none p-0"
					>
						<ChevronDown
							size={12}
							className={cn("transition-transform", isSettingsExpanded ? "rotate-0" : "-rotate-90")}
						/>
						Override Agent Settings
					</button>
				</Collapsible.Trigger>
				<Collapsible.Content className="pt-2">
					<div className="flex flex-col gap-2">
						<div className="w-full sm:w-1/2 min-w-0">
							<span className="text-[11px] text-text-secondary block mb-1">Agent</span>
							<NativeSelect
								size="sm"
								fill
								value={agentId ?? ""}
								onChange={(e) => {
									const value = e.currentTarget.value;
									onAgentIdChange(value ? (value as RuntimeAgentId) : undefined);
									if (value !== "cline") {
										onClineSettingsChange?.(undefined);
										setReasoningEffort("");
									}
								}}
							>
								{agentOptions.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</NativeSelect>
						</div>
						{showClineProviderPicker ? (
							<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
								<div className="min-w-0">
									<span className="text-[11px] text-text-secondary block mb-1">
										Provider{isLoadingProviders ? " (loading\u2026)" : ""}
									</span>
									<SearchSelectDropdown
										options={clineProviderOptions}
										selectedValue={clineProviderId ?? ""}
										onSelect={(value) => {
											const newProviderId = value || undefined;
											const newDefaultModel =
												newProviderId && providerDefaultModels
													? providerDefaultModels[newProviderId]
													: undefined;
											updateTaskClineSettings((currentSettings) => {
												const nextSettings = cloneTaskClineSettings(currentSettings) ?? {};
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
												const preserveEmptyOverride =
													newProviderId !== undefined ||
													(currentSettings !== undefined && Object.keys(currentSettings).length === 0);
												return nextSettings.providerId || nextSettings.modelId || preserveEmptyOverride
													? nextSettings
													: undefined;
											});
											setReasoningEffort(
												newProviderId ||
													(clineSettings !== undefined && Object.keys(clineSettings).length === 0)
													? ""
													: (defaultReasoningEffort ?? ""),
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
								{showClineModelPicker ? (
									<div className="min-w-0">
										<span className="text-[11px] text-text-secondary block mb-1">
											Model{isLoadingModels ? " (loading\u2026)" : ""}
										</span>
										<ClineChatModelSelector
											modelOptions={modelPickerOptions.options}
											recommendedModelIds={modelPickerOptions.recommendedModelIds}
											pinSelectedModelToTop={modelPickerOptions.shouldPinSelectedModelToTop}
											selectedModelId={clineModelId ?? ""}
											selectedModelButtonText={selectedModelButtonText}
											onSelectModel={(value) => {
												updateTaskClineSettings((currentSettings) => {
													const nextSettings = cloneTaskClineSettings(currentSettings) ?? {};
													if (value) {
														nextSettings.modelId = value;
													} else {
														delete nextSettings.modelId;
													}
													if (!value || !reasoningEnabledModelIdSet.has(value)) {
														delete nextSettings.reasoningEffort;
													}
													const preserveEmptyOverride =
														currentSettings !== undefined && Object.keys(currentSettings).length === 0;
													return nextSettings.providerId ||
														nextSettings.modelId ||
														nextSettings.reasoningEffort ||
														preserveEmptyOverride
														? nextSettings
														: undefined;
												});
												if (!value && !clineProviderId) {
													setReasoningEffort(
														clineSettings !== undefined && Object.keys(clineSettings).length === 0
															? ""
															: (defaultReasoningEffort ?? ""),
													);
													return;
												}
												if (!value || !reasoningEnabledModelIdSet.has(value)) {
													setReasoningEffortWithOverride("");
												}
											}}
											reasoningEnabledModelIds={reasoningEnabledModelIds}
											defaultOptionSupportsReasoningEffort={
												!clineModelId && selectedModelSupportsReasoningEffort
											}
											selectedReasoningEffort={reasoningEffort}
											onSelectReasoningEffort={(nextReasoningEffort) =>
												setReasoningEffortWithOverride(nextReasoningEffort)
											}
											disabled={isLoadingModels}
											isModelLoading={isLoadingModels}
											fill
											triggerVariant="default"
											onPopoverOpenChange={setIsModelPopoverOpen}
										/>
									</div>
								) : null}
							</div>
						) : null}
					</div>
				</Collapsible.Content>
			</Collapsible.Root>
		</div>
	);
}
