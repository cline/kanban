import * as Collapsible from "@radix-ui/react-collapsible";
import { getRuntimeAgentCatalogEntry, getRuntimeLaunchSupportedAgentCatalog } from "@runtime-agent-catalog";
import { ChevronDown } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ClineTaskAgentSettingsFields } from "@/components/cline-task-agent-settings-fields";
import { OpaqueTaskAgentSettingsFields } from "@/components/opaque-task-agent-settings-fields";
import { patchAgentSettings, useResetInvalidSelectedModel } from "@/components/task-agent-settings-state";
import { cn } from "@/components/ui/cn";
import { NativeSelect } from "@/components/ui/native-select";
import { fetchClineProviderCatalog, fetchClineProviderModels } from "@/runtime/runtime-config-query";
import type {
	RuntimeAgentId,
	RuntimeClineProviderCatalogItem,
	RuntimeClineProviderModel,
	RuntimeClineReasoningEffort,
	RuntimeTaskAgentSettings,
} from "@/runtime/types";

// ---------------------------------------------------------------------------
// Hook: manages fetch state for Cline provider catalog + model lists
// ---------------------------------------------------------------------------

export interface UseTaskAgentModelPickerInput {
	active: boolean;
	workspaceId: string | null;
	agentId: RuntimeAgentId | undefined;
	agentSettings?: RuntimeTaskAgentSettings;
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
	agentSettings,
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
	const providerId = agentSettings?.providerId;
	const effectiveProviderId = (providerId ?? defaultProviderId ?? "").trim() || null;

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
		if (providerId) {
			const provider = providerCatalog.find((p) => p.id === providerId);
			return provider?.defaultModelId ?? null;
		}
		const inheritedProviderDefaultModelId =
			providerCatalog.find((p) => p.id === defaultProviderId)?.defaultModelId ?? null;
		return defaultModelId ?? inheritedProviderDefaultModelId;
	}, [defaultModelId, defaultProviderId, providerCatalog, providerId]);

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

// ---------------------------------------------------------------------------
// Component: agent override plus Cline or opaque per-task settings
// ---------------------------------------------------------------------------

function nextAgentClearsProvider(nextAgentId: RuntimeAgentId | null): boolean {
	if (!nextAgentId) {
		return true;
	}
	return (getRuntimeAgentCatalogEntry(nextAgentId)?.capabilities.providerOverride ?? "none") === "none";
}

export function TaskAgentModelPicker({
	agentId,
	onAgentIdChange,
	agentSettings,
	onAgentSettingsChange,
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
	agentSettings?: RuntimeTaskAgentSettings | undefined;
	onAgentSettingsChange?: (value: RuntimeTaskAgentSettings | undefined) => void;
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
	const updateTaskAgentSettings = useCallback(
		(updater: (current: RuntimeTaskAgentSettings | undefined) => RuntimeTaskAgentSettings | undefined) => {
			onAgentSettingsChange?.(updater(agentSettings));
		},
		[agentSettings, onAgentSettingsChange],
	);

	const effectiveAgentId = agentId ?? defaultAgentId ?? null;
	const showClineProviderPicker = effectiveAgentId === "cline";
	const effectiveCapabilities = effectiveAgentId
		? (getRuntimeAgentCatalogEntry(effectiveAgentId)?.capabilities ?? null)
		: null;
	const effectiveAgentLabel = effectiveAgentId ? (getRuntimeAgentCatalogEntry(effectiveAgentId)?.label ?? "") : "";
	const showFreeTextModelInput = Boolean(
		effectiveAgentId && effectiveAgentId !== "cline" && effectiveCapabilities?.modelOverride !== "none",
	);
	const showFreeTextEffortInput = Boolean(
		effectiveAgentId && effectiveAgentId !== "cline" && effectiveCapabilities?.effortOverride !== "none",
	);

	const updateOpaqueSetting = useCallback(
		(field: "modelId" | "reasoningEffort", rawValue: string) => {
			const value = rawValue.trim();
			updateTaskAgentSettings((currentSettings) => {
				if (currentSettings === undefined && !value) {
					return undefined;
				}
				return patchAgentSettings(currentSettings, (nextSettings) => {
					if (value) {
						nextSettings[field] = value;
					} else {
						delete nextSettings[field];
					}
				});
			});
		},
		[updateTaskAgentSettings],
	);

	useResetInvalidSelectedModel({
		enabled: showClineProviderPicker,
		modelId: agentSettings?.modelId,
		modelOptions: clineModelOptions,
		isLoadingModels,
		agentSettings,
		onAgentSettingsChange,
	});

	const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);

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
									// Keep model/effort across agent switches; only clear providerId
									// when the next effective agent has providerOverride === "none".
									const nextEffectiveAgentId = value ? (value as RuntimeAgentId) : (defaultAgentId ?? null);
									if (nextAgentClearsProvider(nextEffectiveAgentId)) {
										updateTaskAgentSettings((currentSettings) => {
											if (currentSettings === undefined) {
												return undefined;
											}
											return patchAgentSettings(currentSettings, (nextSettings) => {
												delete nextSettings.providerId;
											});
										});
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
							<ClineTaskAgentSettingsFields
								agentSettings={agentSettings}
								onAgentSettingsChange={onAgentSettingsChange}
								providerOptions={clineProviderOptions}
								modelOptions={clineModelOptions}
								effectiveDefaultModelId={effectiveDefaultModelId}
								providerModels={providerModels}
								isLoadingProviders={isLoadingProviders}
								isLoadingModels={isLoadingModels}
								settingsExpanded={isSettingsExpanded}
								onPopoverOpenChange={onPopoverOpenChange}
								defaultProviderId={defaultProviderId}
								defaultReasoningEffort={defaultReasoningEffort}
								providerDefaultModels={providerDefaultModels}
							/>
						) : null}
						<OpaqueTaskAgentSettingsFields
							agentSettings={agentSettings}
							agentLabel={effectiveAgentLabel}
							docsUrl={effectiveCapabilities?.docsUrl}
							showModelInput={showFreeTextModelInput}
							showEffortInput={showFreeTextEffortInput}
							onModelChange={(value) => updateOpaqueSetting("modelId", value)}
							onEffortChange={(value) => updateOpaqueSetting("reasoningEffort", value)}
						/>
					</div>
				</Collapsible.Content>
			</Collapsible.Root>
		</div>
	);
}
