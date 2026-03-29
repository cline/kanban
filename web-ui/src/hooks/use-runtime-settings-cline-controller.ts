// Owns the Cline-specific settings state machine inside the settings dialog.
// It loads provider data, drives model selection, saves settings, and runs
// OAuth login flows so the dialog component can stay presentation-focused.
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import { getRuntimeClineProviderSettings } from "@/runtime/native-agent";
import {
	fetchClineProviderCatalog,
	fetchClineProviderModels,
	runClineProviderOauthLogin,
	saveClineProviderSettings,
} from "@/runtime/runtime-config-query";
import type {
	RuntimeAgentId,
	RuntimeClineOauthProvider,
	RuntimeClineProviderCatalogItem,
	RuntimeClineProviderModel,
	RuntimeClineProviderSettings,
	RuntimeClineReasoningEffort,
	RuntimeConfigResponse,
} from "@/runtime/types";

interface UseRuntimeSettingsClineControllerOptions {
	open: boolean;
	workspaceId: string | null;
	selectedAgentId: RuntimeAgentId;
	config: RuntimeConfigResponse | null;
}

interface SaveResult {
	ok: boolean;
	message?: string;
}

interface SaveProviderSettingsOverrides {
	providerId?: string;
	modelId?: string | null;
	apiKey?: string | null;
	baseUrl?: string | null;
	reasoningEffort?: RuntimeClineReasoningEffort | null;
}

export interface UseRuntimeSettingsClineControllerResult {
	providerId: string;
	setProviderId: Dispatch<SetStateAction<string>>;
	modelId: string;
	setModelId: Dispatch<SetStateAction<string>>;
	apiKey: string;
	setApiKey: Dispatch<SetStateAction<string>>;
	baseUrl: string;
	setBaseUrl: Dispatch<SetStateAction<string>>;
	reasoningEffort: RuntimeClineReasoningEffort | "";
	setReasoningEffort: Dispatch<SetStateAction<RuntimeClineReasoningEffort | "">>;
	providerCatalog: RuntimeClineProviderCatalogItem[];
	providerModels: RuntimeClineProviderModel[];
	isLoadingProviderCatalog: boolean;
	isLoadingProviderModels: boolean;
	isRunningOauthLogin: boolean;
	normalizedProviderId: string;
	managedOauthProvider: RuntimeClineOauthProvider | null;
	isOauthProviderSelected: boolean;
	apiKeyConfigured: boolean;
	oauthConfigured: boolean;
	oauthAccountId: string;
	oauthExpiresAt: string;
	selectedModelSupportsReasoningEffort: boolean;
	hasUnsavedChanges: boolean;
	saveProviderSettings: (overrides?: SaveProviderSettingsOverrides) => Promise<SaveResult>;
	runOauthLogin: () => Promise<SaveResult>;
}

function toManagedClineOauthProvider(value: string): RuntimeClineOauthProvider | null {
	const normalized = value.trim().toLowerCase();
	if (normalized === "cline" || normalized === "oca" || normalized === "openai-codex") {
		return normalized;
	}
	return null;
}

function normalizeBaseUrlForProvider(providerId: string, baseUrl: string | null | undefined): string {
	if (toManagedClineOauthProvider(providerId)) {
		return "";
	}
	return baseUrl ?? "";
}

function getEffectiveProviderSettings(
	config: RuntimeConfigResponse | null,
	override: RuntimeClineProviderSettings | null,
): RuntimeClineProviderSettings | null {
	return override ?? getRuntimeClineProviderSettings(config);
}

function getDefaultModelIdForProvider(providers: RuntimeClineProviderCatalogItem[], providerId: string): string {
	const normalizedProviderId = providerId.trim().toLowerCase();
	if (!normalizedProviderId) {
		return "";
	}

	return (
		providers.find((provider) => provider.id.trim().toLowerCase() === normalizedProviderId)?.defaultModelId?.trim() ??
		""
	);
}

export function useRuntimeSettingsClineController(
	options: UseRuntimeSettingsClineControllerOptions,
): UseRuntimeSettingsClineControllerResult {
	const { open, workspaceId, selectedAgentId, config } = options;
	const [providerId, setProviderId] = useState("");
	const [modelId, setModelId] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [reasoningEffort, setReasoningEffort] = useState<RuntimeClineReasoningEffort | "">("");
	const [providerSettingsOverride, setProviderSettingsOverride] = useState<RuntimeClineProviderSettings | null>(null);
	const [providerCatalog, setProviderCatalog] = useState<RuntimeClineProviderCatalogItem[]>([]);
	const [providerModels, setProviderModels] = useState<RuntimeClineProviderModel[]>([]);
	const [isLoadingProviderCatalog, setIsLoadingProviderCatalog] = useState(false);
	const [isLoadingProviderModels, setIsLoadingProviderModels] = useState(false);
	const [isRunningOauthLogin, setIsRunningOauthLogin] = useState(false);

	const effectiveProviderSettings = getEffectiveProviderSettings(config, providerSettingsOverride);
	const configProviderSettings = getRuntimeClineProviderSettings(config);
	const initialProviderId = effectiveProviderSettings?.providerId ?? effectiveProviderSettings?.oauthProvider ?? "";
	const initialModelId = effectiveProviderSettings?.modelId ?? "";
	const initialBaseUrl = normalizeBaseUrlForProvider(initialProviderId, effectiveProviderSettings?.baseUrl);
	const initialReasoningEffort = effectiveProviderSettings?.reasoningEffort ?? "";
	const normalizedProviderId = providerId.trim().toLowerCase();
	const managedOauthProvider = toManagedClineOauthProvider(normalizedProviderId);
	const isOauthProviderSelected = managedOauthProvider !== null;
	const apiKeyConfigured = effectiveProviderSettings?.apiKeyConfigured ?? false;
	const oauthConfigured = effectiveProviderSettings?.oauthAccessTokenConfigured ?? false;
	const oauthAccountId = effectiveProviderSettings?.oauthAccountId ?? "";
	const oauthExpiresAt = effectiveProviderSettings?.oauthExpiresAt?.toString() ?? "";
	const selectedModelSupportsReasoningEffort = useMemo(() => {
		return providerModels.find((model) => model.id === modelId)?.supportsReasoningEffort ?? false;
	}, [modelId, providerModels]);

	const hasUnsavedChanges = useMemo(() => {
		if (!config) {
			return false;
		}
		if (providerId.trim() !== initialProviderId.trim()) {
			return true;
		}
		if (modelId.trim() !== initialModelId.trim()) {
			return true;
		}
		if (baseUrl.trim() !== initialBaseUrl.trim()) {
			return true;
		}
		if (reasoningEffort !== initialReasoningEffort) {
			return true;
		}
		return apiKey.trim().length > 0;
	}, [
		apiKey,
		baseUrl,
		config,
		initialBaseUrl,
		initialModelId,
		initialProviderId,
		initialReasoningEffort,
		modelId,
		providerId,
		reasoningEffort,
	]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const nextProviderId = configProviderSettings.providerId ?? configProviderSettings.oauthProvider ?? "";
		setProviderId(nextProviderId);
		setModelId(configProviderSettings.modelId ?? "");
		setApiKey("");
		setBaseUrl(normalizeBaseUrlForProvider(nextProviderId, configProviderSettings.baseUrl));
		setReasoningEffort(configProviderSettings.reasoningEffort ?? "");
		setProviderSettingsOverride(null);
	}, [
		configProviderSettings.baseUrl,
		configProviderSettings.modelId,
		configProviderSettings.oauthProvider,
		configProviderSettings.providerId,
		configProviderSettings.reasoningEffort,
		open,
	]);

	useEffect(() => {
		if (!open || selectedAgentId !== "cline") {
			setProviderCatalog([]);
			setIsLoadingProviderCatalog(false);
			return;
		}
		let cancelled = false;
		setIsLoadingProviderCatalog(true);
		void fetchClineProviderCatalog(workspaceId)
			.then((nextCatalog) => {
				if (cancelled) {
					return;
				}
				setProviderCatalog(nextCatalog);
			})
			.catch(() => {
				if (!cancelled) {
					setProviderCatalog([]);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingProviderCatalog(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [open, selectedAgentId, workspaceId]);

	useEffect(() => {
		if (!open || selectedAgentId !== "cline") {
			return;
		}
		if (providerId.trim().length > 0) {
			return;
		}
		const defaultProvider =
			providerCatalog.find((provider) => provider.id.trim().toLowerCase() === "cline") ?? providerCatalog[0] ?? null;
		if (!defaultProvider) {
			return;
		}
		const nextProviderId = defaultProvider.id.trim();
		if (!nextProviderId) {
			return;
		}
		setProviderId(nextProviderId);
		setModelId(defaultProvider.defaultModelId?.trim() ?? "");
	}, [open, providerCatalog, providerId, selectedAgentId]);

	useEffect(() => {
		if (!open || selectedAgentId !== "cline") {
			return;
		}
		if (providerId.trim().length === 0 || modelId.trim().length > 0) {
			return;
		}
		const defaultModelId = getDefaultModelIdForProvider(providerCatalog, providerId);
		if (!defaultModelId) {
			return;
		}
		setModelId(defaultModelId);
	}, [modelId, open, providerCatalog, providerId, selectedAgentId]);

	useEffect(() => {
		if (!open || selectedAgentId !== "cline") {
			setProviderModels([]);
			setIsLoadingProviderModels(false);
			return;
		}
		const trimmedProviderId = providerId.trim();
		if (trimmedProviderId.length === 0) {
			setProviderModels([]);
			setIsLoadingProviderModels(false);
			return;
		}
		let cancelled = false;
		setIsLoadingProviderModels(true);
		void fetchClineProviderModels(workspaceId, trimmedProviderId)
			.then((nextModels) => {
				if (cancelled) {
					return;
				}
				setProviderModels(nextModels);
			})
			.catch(() => {
				if (!cancelled) {
					setProviderModels([]);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingProviderModels(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [open, providerId, selectedAgentId, workspaceId]);

	const saveProviderSettingsDraft = useCallback(
		async (overrides?: SaveProviderSettingsOverrides): Promise<SaveResult> => {
			if (!overrides && !hasUnsavedChanges) {
				return { ok: true };
			}
			const trimmedProviderId = (overrides?.providerId ?? providerId).trim();
			if (trimmedProviderId.length === 0) {
				return {
					ok: false,
					message: "Choose a Cline provider before saving.",
				};
			}
			const trimmedBaseUrl = toManagedClineOauthProvider(trimmedProviderId)
				? null
				: overrides && "baseUrl" in overrides
					? overrides.baseUrl?.trim() || null
					: baseUrl.trim() || null;
			const trimmedModelId =
				overrides && "modelId" in overrides ? overrides.modelId?.trim() || null : modelId.trim() || null;
			const trimmedApiKey =
				overrides && "apiKey" in overrides
					? overrides.apiKey?.trim() || null
					: managedOauthProvider
						? null
						: apiKey.trim() || null;
			const nextReasoningEffort =
				overrides && "reasoningEffort" in overrides ? (overrides.reasoningEffort ?? null) : reasoningEffort || null;
			try {
				const savedSettings = await saveClineProviderSettings(workspaceId, {
					providerId: trimmedProviderId,
					modelId: trimmedModelId,
					apiKey: trimmedApiKey,
					baseUrl: trimmedBaseUrl,
					reasoningEffort: nextReasoningEffort,
				});
				setProviderId(savedSettings.providerId ?? savedSettings.oauthProvider ?? trimmedProviderId);
				setModelId(savedSettings.modelId ?? "");
				setApiKey("");
				setBaseUrl(savedSettings.baseUrl ?? "");
				setReasoningEffort(savedSettings.reasoningEffort ?? "");
				setProviderSettingsOverride(savedSettings);
				return { ok: true };
			} catch (error) {
				return {
					ok: false,
					message: error instanceof Error ? error.message : String(error),
				};
			}
		},
		[apiKey, baseUrl, hasUnsavedChanges, managedOauthProvider, modelId, providerId, reasoningEffort, workspaceId],
	);

	const runOauthLogin = useCallback(async (): Promise<SaveResult> => {
		if (!managedOauthProvider) {
			return {
				ok: false,
				message: "Choose an OAuth provider from the Provider field first.",
			};
		}
		setIsRunningOauthLogin(true);
		try {
			const response = await runClineProviderOauthLogin(workspaceId, {
				provider: managedOauthProvider,
			});
			if (!response.ok) {
				return {
					ok: false,
					message: response.error ?? "OAuth login failed.",
				};
			}
			const nextSettings = response.settings ?? null;
			if (nextSettings) {
				const nextProviderId = nextSettings.providerId ?? nextSettings.oauthProvider ?? providerId.trim();
				setProviderId(nextProviderId);
				setModelId(nextSettings.modelId ?? getDefaultModelIdForProvider(providerCatalog, nextProviderId));
				setApiKey("");
				setBaseUrl(nextSettings.baseUrl ?? "");
				setReasoningEffort(nextSettings.reasoningEffort ?? "");
			}
			setProviderSettingsOverride(nextSettings);
			return { ok: true };
		} catch (error) {
			return {
				ok: false,
				message: error instanceof Error ? error.message : String(error),
			};
		} finally {
			setIsRunningOauthLogin(false);
		}
	}, [managedOauthProvider, providerCatalog, providerId, workspaceId]);

	return {
		providerId,
		setProviderId,
		modelId,
		setModelId,
		apiKey,
		setApiKey,
		baseUrl,
		setBaseUrl,
		reasoningEffort,
		setReasoningEffort,
		providerCatalog,
		providerModels,
		isLoadingProviderCatalog,
		isLoadingProviderModels,
		isRunningOauthLogin,
		normalizedProviderId,
		managedOauthProvider,
		isOauthProviderSelected,
		apiKeyConfigured,
		oauthConfigured,
		oauthAccountId,
		oauthExpiresAt,
		selectedModelSupportsReasoningEffort,
		hasUnsavedChanges,
		saveProviderSettings: saveProviderSettingsDraft,
		runOauthLogin,
	};
}
