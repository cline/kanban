// Owns the Cline-specific settings state machine inside the settings dialog.
// It loads provider data, drives model selection, saves settings, and runs
// OAuth login flows so the dialog component can stay presentation-focused.
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import { getRuntimeClineProviderSettings } from "@/runtime/native-agent";
import {
	addClineProvider,
	fetchClineProviderCatalog,
	fetchClineProviderModels,
	runClineProviderOauthLogin,
	saveClineProviderSettings,
	updateClineProvider,
} from "@/runtime/runtime-config-query";
import type {
	RuntimeAgentId,
	RuntimeClineOauthProvider,
	RuntimeClineProviderCapability,
	RuntimeClineProviderCatalogItem,
	RuntimeClineProviderModel,
	RuntimeClineProviderSettings,
	RuntimeClineReasoningEffort,
	RuntimeConfigResponse,
	RuntimeTaskClineSettings,
} from "@/runtime/types";

interface UseRuntimeSettingsClineControllerOptions {
	open: boolean;
	workspaceId: string | null;
	selectedAgentId: RuntimeAgentId;
	config: RuntimeConfigResponse | null;
	taskClineSettings?: RuntimeTaskClineSettings;
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
	region?: string | null;
	aws?: {
		accessKey?: string | null;
		secretKey?: string | null;
		sessionToken?: string | null;
		region?: string | null;
		profile?: string | null;
		authentication?: "iam" | "api-key" | "profile" | null;
		endpoint?: string | null;
	};
	gcp?: {
		projectId?: string | null;
		region?: string | null;
	};
}

export interface AddClineProviderInput {
	providerId: string;
	name: string;
	baseUrl: string;
	apiKey?: string | null;
	headers?: Record<string, string>;
	timeoutMs?: number;
	models: string[];
	defaultModelId?: string | null;
	modelsSourceUrl?: string | null;
	capabilities?: RuntimeClineProviderCapability[];
}

export interface UpdateClineProviderInput {
	providerId: string;
	name?: string;
	baseUrl?: string;
	apiKey?: string | null;
	headers?: Record<string, string> | null;
	timeoutMs?: number | null;
	models?: string[];
	defaultModelId?: string | null;
	modelsSourceUrl?: string | null;
	capabilities?: RuntimeClineProviderCapability[];
}

export interface UseRuntimeSettingsClineControllerResult {
	currentProviderSettings: RuntimeClineProviderSettings;
	providerId: string;
	setProviderId: Dispatch<SetStateAction<string>>;
	modelId: string;
	setModelId: Dispatch<SetStateAction<string>>;
	apiKey: string;
	setApiKey: Dispatch<SetStateAction<string>>;
	baseUrl: string;
	setBaseUrl: Dispatch<SetStateAction<string>>;
	region: string;
	setRegion: Dispatch<SetStateAction<string>>;
	reasoningEffort: RuntimeClineReasoningEffort | "";
	setReasoningEffort: Dispatch<SetStateAction<RuntimeClineReasoningEffort | "">>;
	awsAccessKey: string;
	setAwsAccessKey: Dispatch<SetStateAction<string>>;
	awsSecretKey: string;
	setAwsSecretKey: Dispatch<SetStateAction<string>>;
	awsSessionToken: string;
	setAwsSessionToken: Dispatch<SetStateAction<string>>;
	awsRegion: string;
	setAwsRegion: Dispatch<SetStateAction<string>>;
	awsProfile: string;
	setAwsProfile: Dispatch<SetStateAction<string>>;
	awsAuthentication: "" | "iam" | "api-key" | "profile";
	setAwsAuthentication: Dispatch<SetStateAction<"" | "iam" | "api-key" | "profile">>;
	awsEndpoint: string;
	setAwsEndpoint: Dispatch<SetStateAction<string>>;
	gcpProjectId: string;
	setGcpProjectId: Dispatch<SetStateAction<string>>;
	gcpRegion: string;
	setGcpRegion: Dispatch<SetStateAction<string>>;
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
	addCustomProvider: (input: AddClineProviderInput) => Promise<SaveResult>;
	updateCustomProvider: (input: UpdateClineProviderInput) => Promise<SaveResult>;
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

function getDefaultBaseUrlForProvider(providers: RuntimeClineProviderCatalogItem[], providerId: string): string {
	const normalizedProviderId = providerId.trim().toLowerCase();
	if (!normalizedProviderId) {
		return "";
	}
	return (
		providers.find((provider) => provider.id.trim().toLowerCase() === normalizedProviderId)?.baseUrl?.trim() ?? ""
	);
}

function resolveBaseUrlForProvider(
	providers: RuntimeClineProviderCatalogItem[],
	providerId: string,
	baseUrl: string | null | undefined,
): string {
	const normalizedBaseUrl = normalizeBaseUrlForProvider(providerId, baseUrl).trim();
	if (normalizedBaseUrl.length > 0) {
		return normalizedBaseUrl;
	}
	return normalizeBaseUrlForProvider(providerId, getDefaultBaseUrlForProvider(providers, providerId));
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
	const { open, workspaceId, selectedAgentId, config, taskClineSettings } = options;
	const [providerId, setProviderId] = useState("");
	const [modelId, setModelId] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [region, setRegion] = useState("");
	const [reasoningEffort, setReasoningEffort] = useState<RuntimeClineReasoningEffort | "">("");
	const [awsAccessKey, setAwsAccessKey] = useState("");
	const [awsSecretKey, setAwsSecretKey] = useState("");
	const [awsSessionToken, setAwsSessionToken] = useState("");
	const [awsRegion, setAwsRegion] = useState("");
	const [awsProfile, setAwsProfile] = useState("");
	const [awsAuthentication, setAwsAuthentication] = useState<"" | "iam" | "api-key" | "profile">("");
	const [awsEndpoint, setAwsEndpoint] = useState("");
	const [gcpProjectId, setGcpProjectId] = useState("");
	const [gcpRegion, setGcpRegion] = useState("");
	const [providerSettingsOverride, setProviderSettingsOverride] = useState<RuntimeClineProviderSettings | null>(null);
	const [providerCatalog, setProviderCatalog] = useState<RuntimeClineProviderCatalogItem[]>([]);
	const [providerModels, setProviderModels] = useState<RuntimeClineProviderModel[]>([]);
	const [isLoadingProviderCatalog, setIsLoadingProviderCatalog] = useState(false);
	const [isLoadingProviderModels, setIsLoadingProviderModels] = useState(false);
	const [isRunningOauthLogin, setIsRunningOauthLogin] = useState(false);

	const effectiveProviderSettings = getEffectiveProviderSettings(config, providerSettingsOverride);
	const configProviderSettings = getRuntimeClineProviderSettings(config);
	const hasTaskClineSettingsOverride = taskClineSettings !== undefined;
	const initialProviderId =
		taskClineSettings?.providerId ||
		effectiveProviderSettings?.providerId ||
		effectiveProviderSettings?.oauthProvider ||
		"";
	const initialModelId = taskClineSettings?.modelId || effectiveProviderSettings?.modelId || "";
	const initialBaseUrl = resolveBaseUrlForProvider(
		providerCatalog,
		initialProviderId,
		effectiveProviderSettings?.baseUrl,
	);
	const initialReasoningEffort = hasTaskClineSettingsOverride
		? (taskClineSettings?.reasoningEffort ?? "")
		: (effectiveProviderSettings?.reasoningEffort ?? "");
	const normalizedProviderId = providerId.trim().toLowerCase();
	const managedOauthProvider = toManagedClineOauthProvider(normalizedProviderId);
	const isOauthProviderSelected = managedOauthProvider !== null;
	const apiKeyConfigured = effectiveProviderSettings?.apiKeyConfigured ?? false;
	const oauthConfigured = effectiveProviderSettings?.oauthAccessTokenConfigured ?? false;
	const oauthAccountId = effectiveProviderSettings?.oauthAccountId ?? "";
	const oauthExpiresAt = effectiveProviderSettings?.oauthExpiresAt?.toString() ?? "";
	const currentProviderSettings = useMemo<RuntimeClineProviderSettings>(() => {
		const baseSettings = effectiveProviderSettings ?? getRuntimeClineProviderSettings(null);
		const isSelectedManagedOauthProvider =
			managedOauthProvider !== null && managedOauthProvider === baseSettings.oauthProvider;
		return {
			...baseSettings,
			providerId: managedOauthProvider === null ? providerId.trim() || null : null,
			modelId: modelId.trim() || null,
			baseUrl: managedOauthProvider === null ? baseUrl.trim() || null : null,
			reasoningEffort: reasoningEffort || null,
			apiKeyConfigured: managedOauthProvider === null ? baseSettings.apiKeyConfigured : false,
			oauthProvider: managedOauthProvider,
			oauthAccessTokenConfigured: isSelectedManagedOauthProvider ? baseSettings.oauthAccessTokenConfigured : false,
			oauthRefreshTokenConfigured: isSelectedManagedOauthProvider ? baseSettings.oauthRefreshTokenConfigured : false,
			oauthAccountId: isSelectedManagedOauthProvider ? baseSettings.oauthAccountId : null,
			oauthExpiresAt: isSelectedManagedOauthProvider ? baseSettings.oauthExpiresAt : null,
		};
	}, [baseUrl, effectiveProviderSettings, managedOauthProvider, modelId, providerId, reasoningEffort]);
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
		if (region.trim().length > 0) {
			return true;
		}
		if (awsAccessKey.trim().length > 0 || awsSecretKey.trim().length > 0 || awsSessionToken.trim().length > 0) {
			return true;
		}
		if (awsRegion.trim().length > 0 || awsProfile.trim().length > 0 || awsAuthentication.trim().length > 0) {
			return true;
		}
		if (awsEndpoint.trim().length > 0 || gcpProjectId.trim().length > 0 || gcpRegion.trim().length > 0) {
			return true;
		}
		return apiKey.trim().length > 0;
	}, [
		apiKey,
		awsAccessKey,
		awsAuthentication,
		awsEndpoint,
		awsProfile,
		awsRegion,
		awsSecretKey,
		awsSessionToken,
		baseUrl,
		config,
		gcpProjectId,
		gcpRegion,
		initialBaseUrl,
		initialModelId,
		initialProviderId,
		initialReasoningEffort,
		modelId,
		providerId,
		region,
		reasoningEffort,
	]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const nextProviderId =
			taskClineSettings?.providerId ||
			(configProviderSettings.providerId ?? configProviderSettings.oauthProvider ?? "");
		setProviderId(nextProviderId);
		setModelId(taskClineSettings?.modelId || (configProviderSettings.modelId ?? ""));
		setApiKey("");
		setBaseUrl(resolveBaseUrlForProvider(providerCatalog, nextProviderId, configProviderSettings.baseUrl));
		setRegion("");
		setReasoningEffort(
			hasTaskClineSettingsOverride
				? (taskClineSettings?.reasoningEffort ?? "")
				: (configProviderSettings.reasoningEffort ?? ""),
		);
		setAwsAccessKey("");
		setAwsSecretKey("");
		setAwsSessionToken("");
		setAwsRegion("");
		setAwsProfile("");
		setAwsAuthentication("");
		setAwsEndpoint("");
		setGcpProjectId("");
		setGcpRegion("");
		setProviderSettingsOverride(null);
	}, [
		configProviderSettings.baseUrl,
		configProviderSettings.modelId,
		configProviderSettings.oauthProvider,
		configProviderSettings.providerId,
		configProviderSettings.reasoningEffort,
		hasTaskClineSettingsOverride,
		open,
		taskClineSettings,
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
		setBaseUrl(resolveBaseUrlForProvider(providerCatalog, nextProviderId, null));
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
			return;
		}
		if (providerId.trim().length === 0 || baseUrl.trim().length > 0) {
			return;
		}
		const defaultBaseUrl = getDefaultBaseUrlForProvider(providerCatalog, providerId);
		if (!defaultBaseUrl) {
			return;
		}
		setBaseUrl(normalizeBaseUrlForProvider(providerId, defaultBaseUrl));
	}, [baseUrl, open, providerCatalog, providerId, selectedAgentId]);

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
			const nextRegion =
				overrides && "region" in overrides ? overrides.region?.trim() || null : region.trim() || null;
			const normalizedProviderId = trimmedProviderId.toLowerCase();
			const isBedrockProvider = normalizedProviderId === "bedrock";
			const isVertexProvider = normalizedProviderId === "vertex";
			const nextAws =
				overrides && "aws" in overrides
					? overrides.aws
					: isBedrockProvider
						? {
								accessKey: awsAccessKey.trim() || null,
								secretKey: awsSecretKey.trim() || null,
								sessionToken: awsSessionToken.trim() || null,
								region: awsRegion.trim() || null,
								profile: awsProfile.trim() || null,
								authentication: awsAuthentication || null,
								endpoint: awsEndpoint.trim() || null,
							}
						: undefined;
			const nextGcp =
				overrides && "gcp" in overrides
					? overrides.gcp
					: isVertexProvider
						? {
								projectId: gcpProjectId.trim() || null,
								region: gcpRegion.trim() || null,
							}
						: undefined;
			const payloadRegion = isVertexProvider ? nextRegion : null;
			try {
				const savedSettings = await saveClineProviderSettings(workspaceId, {
					providerId: trimmedProviderId,
					modelId: trimmedModelId,
					apiKey: trimmedApiKey,
					baseUrl: trimmedBaseUrl,
					reasoningEffort: nextReasoningEffort,
					...(isVertexProvider ? { region: payloadRegion } : {}),
					...(nextAws !== undefined ? { aws: nextAws } : {}),
					...(nextGcp !== undefined ? { gcp: nextGcp } : {}),
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
		[
			apiKey,
			awsAccessKey,
			awsAuthentication,
			awsEndpoint,
			awsProfile,
			awsRegion,
			awsSecretKey,
			awsSessionToken,
			baseUrl,
			gcpProjectId,
			gcpRegion,
			hasUnsavedChanges,
			managedOauthProvider,
			modelId,
			providerId,
			region,
			reasoningEffort,
			workspaceId,
		],
	);

	const addCustomProvider = useCallback(
		async (input: AddClineProviderInput): Promise<SaveResult> => {
			try {
				const savedSettings = await addClineProvider(workspaceId, input);
				const nextProviderId = savedSettings.providerId ?? input.providerId.trim().toLowerCase();
				setProviderId(nextProviderId);
				setModelId(savedSettings.modelId ?? input.defaultModelId?.trim() ?? input.models[0] ?? "");
				setApiKey("");
				setBaseUrl(savedSettings.baseUrl ?? input.baseUrl);
				setReasoningEffort(savedSettings.reasoningEffort ?? "");
				setProviderSettingsOverride(savedSettings);

				setIsLoadingProviderCatalog(true);
				try {
					setProviderCatalog(await fetchClineProviderCatalog(workspaceId));
				} finally {
					setIsLoadingProviderCatalog(false);
				}

				setIsLoadingProviderModels(true);
				try {
					setProviderModels(await fetchClineProviderModels(workspaceId, nextProviderId));
				} finally {
					setIsLoadingProviderModels(false);
				}

				return { ok: true };
			} catch (error) {
				return {
					ok: false,
					message: error instanceof Error ? error.message : String(error),
				};
			}
		},
		[workspaceId],
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

	const updateCustomProvider = useCallback(
		async (input: UpdateClineProviderInput): Promise<SaveResult> => {
			try {
				const savedSettings = await updateClineProvider(workspaceId, input);
				const nextProviderId = savedSettings.providerId ?? input.providerId.trim().toLowerCase();
				setProviderId(nextProviderId);
				setModelId(savedSettings.modelId ?? input.defaultModelId?.trim() ?? modelId);
				setApiKey("");
				setBaseUrl(savedSettings.baseUrl ?? input.baseUrl ?? baseUrl);
				setReasoningEffort(savedSettings.reasoningEffort ?? "");
				setProviderSettingsOverride(savedSettings);

				setIsLoadingProviderCatalog(true);
				try {
					setProviderCatalog(await fetchClineProviderCatalog(workspaceId));
				} finally {
					setIsLoadingProviderCatalog(false);
				}

				setIsLoadingProviderModels(true);
				try {
					setProviderModels(await fetchClineProviderModels(workspaceId, nextProviderId));
				} finally {
					setIsLoadingProviderModels(false);
				}

				return { ok: true };
			} catch (error) {
				return {
					ok: false,
					message: error instanceof Error ? error.message : String(error),
				};
			}
		},
		[baseUrl, modelId, workspaceId],
	);

	return {
		currentProviderSettings,
		providerId,
		setProviderId,
		modelId,
		setModelId,
		apiKey,
		setApiKey,
		baseUrl,
		setBaseUrl,
		region,
		setRegion,
		reasoningEffort,
		setReasoningEffort,
		awsAccessKey,
		setAwsAccessKey,
		awsSecretKey,
		setAwsSecretKey,
		awsSessionToken,
		setAwsSessionToken,
		awsRegion,
		setAwsRegion,
		awsProfile,
		setAwsProfile,
		awsAuthentication,
		setAwsAuthentication,
		awsEndpoint,
		setAwsEndpoint,
		gcpProjectId,
		setGcpProjectId,
		gcpRegion,
		setGcpRegion,
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
		addCustomProvider,
		updateCustomProvider,
		runOauthLogin,
	};
}
