// Kanban-facing facade over the SDK-backed provider store.
// It resolves provider settings, model catalogs, OAuth flows, and launch
// config without leaking SDK details into runtime-api.ts or the UI.

import { z } from "zod";
import type {
	RuntimeClineAccountProfileResponse,
	RuntimeClineKanbanAccessResponse,
	RuntimeClineOauthLoginResponse,
	RuntimeClineProviderCatalogItem,
	RuntimeClineProviderCatalogResponse,
	RuntimeClineProviderModel,
	RuntimeClineProviderModelsResponse,
	RuntimeClineProviderSettings,
	RuntimeClineProviderSettingsSaveResponse,
	RuntimeClineReasoningEffort,
} from "../core/api-contract";
import { openInBrowser } from "../server/browser";
import {
	addSdkCustomProvider,
	deleteSdkCustomProvider,
	fetchSdkClineAccountProfile,
	fetchSdkClineUserRemoteConfig,
	fetchSdkFeaturebaseToken,
	fetchSdkOrgData,
	getLastUsedSdkProviderSettings,
	getSdkProviderSettings,
	listSdkProviderCatalog,
	listSdkProviderModels,
	loginManagedOauthProvider,
	type ManagedClineOauthProviderId,
	refreshManagedOauthCredentials,
	SDK_DEFAULT_MODEL_ID,
	SDK_DEFAULT_PROVIDER_ID,
	type SdkCustomProviderCapability,
	type SdkProviderModelRecord,
	type SdkProviderSettings,
	saveSdkProviderSettings,
	supportsSdkModelThinking,
	updateSdkCustomProvider,
} from "./sdk-provider-boundary";

const WORKOS_TOKEN_PREFIX = "workos:";
const DEFAULT_CLINE_API_BASE_URL = "https://api.cline.bot";
const MANAGED_PROVIDER_ENV_KEYS: Record<ManagedClineOauthProviderId, readonly string[]> = {
	cline: ["CLINE_API_KEY"],
	oca: ["OCA_API_KEY"],
	"openai-codex": [],
};
const CLINE_REMOTE_CONFIG_SCHEMA = z.object({
	kanbanEnabled: z.boolean().optional(),
});

type ClineRemoteConfig = z.infer<typeof CLINE_REMOTE_CONFIG_SCHEMA>;
type SdkReasoningEffort = NonNullable<NonNullable<SdkProviderSettings["reasoning"]>["effort"]>;

export interface ResolvedClineLaunchConfig {
	providerId: string;
	modelId: string | null;
	apiKey: string | null;
	baseUrl: string | null;
	reasoningEffort: RuntimeClineReasoningEffort | null;
}

export interface AddCustomClineProviderInput {
	providerId: string;
	name: string;
	baseUrl: string;
	apiKey?: string | null;
	headers?: Record<string, string>;
	timeoutMs?: number;
	models: string[];
	defaultModelId?: string | null;
	modelsSourceUrl?: string | null;
	capabilities?: SdkCustomProviderCapability[];
}

export interface UpdateCustomClineProviderInput {
	providerId: string;
	name?: string;
	baseUrl?: string;
	apiKey?: string | null;
	headers?: Record<string, string> | null;
	timeoutMs?: number | null;
	models?: string[];
	defaultModelId?: string | null;
	modelsSourceUrl?: string | null;
	capabilities?: SdkCustomProviderCapability[];
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function parseClineRemoteConfigValue(value: string): ClineRemoteConfig {
	const parsed = JSON.parse(value) as unknown;
	return CLINE_REMOTE_CONFIG_SCHEMA.parse(parsed);
}

function isManagedOauthProviderId(providerId: string): providerId is ManagedClineOauthProviderId {
	return providerId === "cline" || providerId === "oca" || providerId === "openai-codex";
}

function formatManagedProviderDisplayName(providerId: ManagedClineOauthProviderId): string {
	if (providerId === "cline") {
		return "Cline";
	}
	if (providerId === "oca") {
		return "Oracle Code Assist";
	}
	return "OpenAI Codex";
}

function stripWorkosPrefix(accessToken: string): string {
	if (accessToken.toLowerCase().startsWith(WORKOS_TOKEN_PREFIX)) {
		return accessToken.slice(WORKOS_TOKEN_PREFIX.length);
	}
	return accessToken;
}

function ensureWorkosPrefix(accessToken: string): string {
	const normalized = accessToken.trim();
	if (!normalized) {
		return normalized;
	}
	if (normalized.toLowerCase().startsWith(WORKOS_TOKEN_PREFIX)) {
		return normalized;
	}
	return `${WORKOS_TOKEN_PREFIX}${normalized}`;
}

function toProviderApiKey(providerId: ManagedClineOauthProviderId, accessToken: string): string {
	if (providerId === "cline") {
		return `${WORKOS_TOKEN_PREFIX}${accessToken}`;
	}
	return accessToken;
}

function normalizeEpochMs(expiresAt: number | null | undefined): number {
	if (!expiresAt || !Number.isFinite(expiresAt) || expiresAt <= 0) {
		return Date.now() - 1;
	}
	if (expiresAt >= 1_000_000_000_000) {
		return Math.floor(expiresAt);
	}
	return Math.floor(expiresAt * 1000);
}

function toResponseExpirySeconds(expiresAt: number | null | undefined): number | null {
	if (!expiresAt || !Number.isFinite(expiresAt) || expiresAt <= 0) {
		return null;
	}
	return Math.max(1, Math.floor(normalizeEpochMs(expiresAt) / 1000));
}

function resolveVisibleApiKey(settings: SdkProviderSettings | null): string | null {
	const apiKey = settings?.apiKey?.trim() || settings?.auth?.apiKey?.trim() || "";
	return apiKey.length > 0 ? apiKey : null;
}

function readEnvApiKey(envKey: string): string | null {
	const apiKey = process.env[envKey]?.trim() ?? "";
	return apiKey.length > 0 ? apiKey : null;
}

function toRuntimeReasoningEffort(effort: SdkReasoningEffort | null | undefined): RuntimeClineReasoningEffort | null {
	if (!effort || effort === "none") {
		return null;
	}
	return effort;
}

function resolveManagedProviderEnvApiKey(providerId: ManagedClineOauthProviderId): string | null {
	for (const envKey of MANAGED_PROVIDER_ENV_KEYS[providerId]) {
		const apiKey = readEnvApiKey(envKey);
		if (apiKey) {
			return apiKey;
		}
	}
	return null;
}

function resolveManagedProviderLaunchApiKey(input: {
	providerId: ManagedClineOauthProviderId;
	settings: SdkProviderSettings;
	oauthApiKey: string | null;
}): string {
	const resolvedApiKey =
		input.oauthApiKey ?? resolveVisibleApiKey(input.settings) ?? resolveManagedProviderEnvApiKey(input.providerId);
	if (resolvedApiKey) {
		return resolvedApiKey;
	}

	const envKeys = MANAGED_PROVIDER_ENV_KEYS[input.providerId];
	const envHelp = envKeys.length > 0 ? ` or set ${envKeys.join(" or ")}` : "";
	throw new Error(
		`${formatManagedProviderDisplayName(input.providerId)} provider is selected but no ${formatManagedProviderDisplayName(input.providerId)} credentials are configured. Sign in from Settings${envHelp} before starting a native Cline task.`,
	);
}

function hasOauthAccessToken(settings: SdkProviderSettings | null): boolean {
	return (settings?.auth?.accessToken?.trim() ?? "").length > 0;
}

function hasOauthRefreshToken(settings: SdkProviderSettings | null): boolean {
	return (settings?.auth?.refreshToken?.trim() ?? "").length > 0;
}

function toRuntimeProviderModel(modelId: string, modelInfo: SdkProviderModelRecord[string]): RuntimeClineProviderModel {
	const capabilities = new Set(modelInfo.capabilities ?? []);
	const supportsVision = capabilities.has("images");
	const supportsAttachments = capabilities.has("files") || supportsVision;
	const supportsReasoningEffort = supportsSdkModelThinking(modelInfo);
	return {
		id: modelId,
		name: modelInfo.name?.trim() || modelId,
		supportsVision: supportsVision || undefined,
		supportsAttachments: supportsAttachments || undefined,
		supportsReasoningEffort: supportsReasoningEffort || undefined,
	};
}

function createEmptyProviderSettingsSummary(): RuntimeClineProviderSettings {
	return {
		providerId: null,
		modelId: null,
		baseUrl: null,
		reasoningEffort: null,
		apiKeyConfigured: false,
		oauthProvider: null,
		oauthAccessTokenConfigured: false,
		oauthRefreshTokenConfigured: false,
		oauthAccountId: null,
		oauthExpiresAt: null,
	};
}

function toProviderSettingsSummary(settings: SdkProviderSettings | null): RuntimeClineProviderSettings {
	if (!settings) {
		return createEmptyProviderSettingsSummary();
	}

	const providerId = settings.provider?.trim() || null;
	const oauthProvider = providerId && isManagedOauthProviderId(providerId) ? providerId : null;

	return {
		providerId,
		modelId: settings.model?.trim() || null,
		baseUrl: settings.baseUrl?.trim() || null,
		reasoningEffort: toRuntimeReasoningEffort(settings.reasoning?.effort),
		apiKeyConfigured: Boolean(resolveVisibleApiKey(settings)),
		oauthProvider,
		oauthAccessTokenConfigured: hasOauthAccessToken(settings),
		oauthRefreshTokenConfigured: hasOauthRefreshToken(settings),
		oauthAccountId: settings.auth?.accountId?.trim() || null,
		oauthExpiresAt: toResponseExpirySeconds(settings.auth?.expiresAt),
	};
}

function getSelectedProviderSettings(): SdkProviderSettings | null {
	const lastUsedSettings = getLastUsedSdkProviderSettings();
	const resolvedProviderId = lastUsedSettings?.provider?.trim().toLowerCase() || SDK_DEFAULT_PROVIDER_ID;
	return (
		getSdkProviderSettings(resolvedProviderId) ??
		lastUsedSettings ?? {
			provider: resolvedProviderId,
		}
	);
}

async function resolveDefaultModelIdForProvider(providerId: string): Promise<string | null> {
	const normalizedProviderId = providerId.trim().toLowerCase();
	if (!normalizedProviderId) {
		return SDK_DEFAULT_MODEL_ID;
	}
	try {
		const provider = (await listSdkProviderCatalog()).find((candidate) => candidate.id === normalizedProviderId);
		const defaultModelId = provider?.defaultModelId?.trim();
		if (defaultModelId) {
			return defaultModelId;
		}
	} catch {
		// Fall through to the stable built-in defaults.
	}
	return normalizedProviderId === SDK_DEFAULT_PROVIDER_ID ? SDK_DEFAULT_MODEL_ID : null;
}

function createRuntimeOauthCallbacks(providerId: ManagedClineOauthProviderId) {
	let authUrl: string | null = null;
	return {
		onAuth: ({ url }: { url: string; instructions?: string }) => {
			authUrl = url;
			openInBrowser(url);
		},
		onPrompt: async () => {
			throw new Error(
				authUrl
					? `Browser callback did not complete. Open this URL and complete sign in: ${authUrl}`
					: `Browser callback did not complete for ${providerId}.`,
			);
		},
		onProgress: () => {},
	};
}

function authSettingsEqual(left: SdkProviderSettings["auth"], right: SdkProviderSettings["auth"]): boolean {
	return (
		(left?.accessToken ?? null) === (right?.accessToken ?? null) &&
		(left?.refreshToken ?? null) === (right?.refreshToken ?? null) &&
		(left?.accountId ?? null) === (right?.accountId ?? null) &&
		(left?.expiresAt ?? null) === (right?.expiresAt ?? null)
	);
}

async function refreshManagedOauthSettings(
	settings: SdkProviderSettings,
): Promise<{ settings: SdkProviderSettings; apiKey: string } | null> {
	const providerId = settings.provider.trim().toLowerCase();
	if (!isManagedOauthProviderId(providerId)) {
		return null;
	}

	const accessToken = settings.auth?.accessToken?.trim() ?? "";
	const refreshToken = settings.auth?.refreshToken?.trim() ?? "";
	if (!accessToken || !refreshToken) {
		return null;
	}

	const nextCredentials = await refreshManagedOauthCredentials({
		providerId,
		currentCredentials: {
			access: providerId === "cline" ? stripWorkosPrefix(accessToken) : accessToken,
			refresh: refreshToken,
			expires: normalizeEpochMs(settings.auth?.expiresAt),
			accountId: settings.auth?.accountId ?? undefined,
		},
		baseUrl: settings.baseUrl?.trim() || null,
		oauthProvider: providerId,
	});
	if (!nextCredentials) {
		throw new Error(`OAuth credentials for provider "${providerId}" are invalid. Re-run OAuth login.`);
	}

	const nextSettings: SdkProviderSettings = {
		...settings,
		auth: {
			...(settings.auth ?? {}),
			accessToken: toProviderApiKey(providerId, nextCredentials.access),
			refreshToken: nextCredentials.refresh,
			accountId: nextCredentials.accountId ?? undefined,
			expiresAt: normalizeEpochMs(nextCredentials.expires),
		},
	};

	if (!authSettingsEqual(settings.auth, nextSettings.auth)) {
		saveSdkProviderSettings({
			settings: nextSettings,
			tokenSource: "oauth",
			setLastUsed: true,
		});
	}

	return {
		settings: nextSettings,
		apiKey: toProviderApiKey(providerId, nextCredentials.access),
	};
}

export function createClineProviderService() {
	const getProviderSettingsSummary = (): RuntimeClineProviderSettings =>
		toProviderSettingsSummary(getSelectedProviderSettings());

	return {
		getProviderSettingsSummary(): RuntimeClineProviderSettings {
			return getProviderSettingsSummary();
		},

		async getClineAccountProfile(): Promise<RuntimeClineAccountProfileResponse> {
			try {
				const selectedSettings = getSelectedProviderSettings();
				if (!selectedSettings) {
					return {
						profile: null,
					};
				}

				const normalizedProviderId = selectedSettings.provider.trim().toLowerCase();
				if (normalizedProviderId !== "cline") {
					return {
						profile: null,
					};
				}

				const tryFetchProfile = async (
					settings: SdkProviderSettings,
				): Promise<RuntimeClineAccountProfileResponse["profile"] | null> => {
					const rawAccessToken = settings.auth?.accessToken?.trim() ?? "";
					if (!rawAccessToken) {
						return null;
					}
					const me = await fetchSdkClineAccountProfile({
						apiBaseUrl: settings.baseUrl?.trim() || DEFAULT_CLINE_API_BASE_URL,
						accessToken: ensureWorkosPrefix(rawAccessToken),
					});
					return {
						accountId: me.id?.trim() || settings.auth?.accountId?.trim() || null,
						email: me.email?.trim() || null,
						displayName: me.displayName?.trim() || null,
					};
				};

				try {
					const profile = await tryFetchProfile(selectedSettings);
					if (profile) {
						return {
							profile,
						};
					}
				} catch {
					// Retry once after OAuth refresh below.
				}

				const oauthResolution = await refreshManagedOauthSettings(selectedSettings);
				const profile = oauthResolution?.settings ? await tryFetchProfile(oauthResolution.settings) : null;
				return {
					profile,
				};
			} catch (error) {
				return {
					profile: null,
					error: toErrorMessage(error),
				};
			}
		},

		async getClineKanbanAccess(): Promise<RuntimeClineKanbanAccessResponse> {
			try {
				const selectedSettings = getSelectedProviderSettings();
				if (!selectedSettings) {
					return { enabled: true };
				}

				const rawAccessToken = selectedSettings.auth?.accessToken?.trim() ?? "";
				if (!rawAccessToken) {
					return { enabled: true };
				}

				const remoteConfigResponse = await fetchSdkClineUserRemoteConfig({
					apiBaseUrl: selectedSettings.baseUrl?.trim() || DEFAULT_CLINE_API_BASE_URL,
					accessToken: ensureWorkosPrefix(rawAccessToken),
				});
				if (!remoteConfigResponse?.enabled || !remoteConfigResponse?.organizationId) {
					return { enabled: true };
				}

				const orgData = await fetchSdkOrgData({
					apiBaseUrl: selectedSettings.baseUrl?.trim() || DEFAULT_CLINE_API_BASE_URL,
					accessToken: ensureWorkosPrefix(rawAccessToken),
					organizatinId: remoteConfigResponse.organizationId,
				});

				const parsedRemoteConfig = parseClineRemoteConfigValue(remoteConfigResponse.value);
				const isEnterpriseCustomer = !!orgData?.externalOrganizationId;
				return {
					enabled: !parsedRemoteConfig || !isEnterpriseCustomer || parsedRemoteConfig.kanbanEnabled === true,
				};
			} catch (error) {
				return {
					enabled: true,
					error: toErrorMessage(error),
				};
			}
		},

		async getFeaturebaseToken(): Promise<{ featurebaseJwt: string }> {
			const selectedSettings = getSelectedProviderSettings();
			if (!selectedSettings) {
				throw new Error("No provider settings configured.");
			}

			const normalizedProviderId = selectedSettings.provider.trim().toLowerCase();
			if (normalizedProviderId !== "cline") {
				throw new Error("Featurebase token requires a Cline provider.");
			}

			const tryFetchToken = async (settings: SdkProviderSettings): Promise<{ featurebaseJwt: string }> => {
				const rawAccessToken = settings.auth?.accessToken?.trim() ?? "";
				if (!rawAccessToken) {
					throw new Error("No access token configured for Cline provider.");
				}
				return await fetchSdkFeaturebaseToken({
					apiBaseUrl: settings.baseUrl?.trim() || DEFAULT_CLINE_API_BASE_URL,
					accessToken: ensureWorkosPrefix(rawAccessToken),
				});
			};

			try {
				return await tryFetchToken(selectedSettings);
			} catch {
				// Retry once after OAuth refresh.
			}

			const oauthResolution = await refreshManagedOauthSettings(selectedSettings);
			if (oauthResolution?.settings) {
				return await tryFetchToken(oauthResolution.settings);
			}
			throw new Error("Failed to fetch Featurebase token.");
		},

		async resolveLaunchConfig(): Promise<ResolvedClineLaunchConfig> {
			const selectedSettings = getSelectedProviderSettings();
			if (!selectedSettings) {
				throw new Error(
					"No native Cline provider is configured. Open Settings, choose a provider, and then start the task again.",
				);
			}

			const normalizedProviderId = selectedSettings.provider.trim().toLowerCase();
			if (!normalizedProviderId) {
				throw new Error(
					"No native Cline provider is configured. Open Settings, choose a provider, and then start the task again.",
				);
			}
			const oauthResolution = await refreshManagedOauthSettings(selectedSettings);
			const resolvedSettings = oauthResolution?.settings ?? selectedSettings;
			const apiKey = isManagedOauthProviderId(normalizedProviderId)
				? resolveManagedProviderLaunchApiKey({
						providerId: normalizedProviderId,
						settings: resolvedSettings,
						oauthApiKey: oauthResolution?.apiKey ?? null,
					})
				: resolveVisibleApiKey(resolvedSettings);
			return {
				providerId: normalizedProviderId,
				modelId: resolvedSettings.model?.trim() || (await resolveDefaultModelIdForProvider(normalizedProviderId)),
				apiKey,
				baseUrl: resolvedSettings.baseUrl?.trim() || null,
				reasoningEffort: toRuntimeReasoningEffort(resolvedSettings.reasoning?.effort),
			};
		},

		async getProviderCatalog(): Promise<RuntimeClineProviderCatalogResponse> {
			const selectedProviderId = getProviderSettingsSummary().providerId?.trim().toLowerCase() ?? "";
			const providers: RuntimeClineProviderCatalogItem[] = await listSdkProviderCatalog()
				.then((sdkProviders) =>
					sdkProviders
						.map((provider) => ({
							id: provider.id,
							name: provider.name,
							oauthSupported: (provider.capabilities ?? []).includes("oauth"),
							enabled:
								selectedProviderId.length > 0 ? selectedProviderId === provider.id : provider.id === "cline",
							defaultModelId: provider.defaultModelId ?? null,
							baseUrl: provider.baseUrl?.trim() || null,
							supportsBaseUrl: (provider.baseUrl?.trim().length ?? 0) > 0,
							env: provider.env,
						}))
						.sort((left, right) => {
							if (left.id === "cline") {
								return -1;
							}
							if (right.id === "cline") {
								return 1;
							}
							return left.name.localeCompare(right.name);
						}),
				)
				.catch(() => []);

			if (selectedProviderId.length > 0 && !providers.some((provider) => provider.id === selectedProviderId)) {
				providers.unshift({
					id: selectedProviderId,
					name: selectedProviderId,
					oauthSupported: false,
					enabled: true,
					defaultModelId: getProviderSettingsSummary().modelId,
					baseUrl: getProviderSettingsSummary().baseUrl,
					supportsBaseUrl: (getProviderSettingsSummary().baseUrl?.trim().length ?? 0) > 0,
					env: undefined,
				});
			}

			return {
				providers,
			};
		},

		async getProviderModels(providerId: string): Promise<RuntimeClineProviderModelsResponse> {
			const normalizedProviderId = providerId.trim().toLowerCase();
			const providerModels =
				normalizedProviderId.length > 0
					? await listSdkProviderModels(normalizedProviderId)
							.then((sdkModels) =>
								Object.entries(sdkModels)
									.map(([modelId, modelInfo]) => toRuntimeProviderModel(modelId, modelInfo))
									.sort((left, right) => left.name.localeCompare(right.name)),
							)
							.catch(() => [])
					: [];

			if (providerModels.length > 0) {
				return {
					providerId: normalizedProviderId,
					models: providerModels,
				};
			}

			const configuredModel = getProviderSettingsSummary().modelId?.trim() ?? "";
			if (configuredModel.length > 0) {
				return {
					providerId: normalizedProviderId || providerId,
					models: [{ id: configuredModel, name: configuredModel }],
				};
			}

			return {
				providerId: normalizedProviderId || providerId,
				models: [],
			};
		},

		async addCustomProvider(input: AddCustomClineProviderInput): Promise<RuntimeClineProviderSettings> {
			const providerId = input.providerId.trim().toLowerCase();
			const existingProviders = await listSdkProviderCatalog().catch(() => []);
			if (existingProviders.some((provider) => provider.id.trim().toLowerCase() === providerId)) {
				throw new Error(`Provider "${providerId}" already exists.`);
			}

			await addSdkCustomProvider({
				providerId,
				name: input.name,
				baseUrl: input.baseUrl,
				apiKey: input.apiKey ?? null,
				headers: input.headers,
				timeoutMs: input.timeoutMs,
				models: input.models,
				defaultModelId: input.defaultModelId ?? null,
				modelsSourceUrl: input.modelsSourceUrl ?? null,
				capabilities: input.capabilities,
			});

			const existingSettings = getSdkProviderSettings(providerId) ?? { provider: providerId };
			saveSdkProviderSettings({
				settings: existingSettings,
				tokenSource: hasOauthAccessToken(existingSettings) ? "oauth" : "manual",
				setLastUsed: true,
			});

			return toProviderSettingsSummary(getSdkProviderSettings(providerId));
		},

		async updateCustomProvider(input: UpdateCustomClineProviderInput): Promise<RuntimeClineProviderSettings> {
			const providerId = input.providerId.trim().toLowerCase();
			if (!providerId) {
				throw new Error("Provider ID cannot be empty.");
			}

			await updateSdkCustomProvider({
				providerId,
				name: input.name,
				baseUrl: input.baseUrl,
				apiKey: input.apiKey ?? undefined,
				headers: input.headers ?? undefined,
				timeoutMs: input.timeoutMs ?? undefined,
				models: input.models,
				defaultModelId: input.defaultModelId ?? undefined,
				modelsSourceUrl: input.modelsSourceUrl ?? undefined,
				capabilities: input.capabilities,
			});

			const existingSettings = getSdkProviderSettings(providerId) ?? { provider: providerId };
			const isLastUsed = getLastUsedSdkProviderSettings()?.provider?.trim().toLowerCase() === providerId;
			saveSdkProviderSettings({
				settings: existingSettings,
				tokenSource: hasOauthAccessToken(existingSettings) ? "oauth" : "manual",
				setLastUsed: isLastUsed,
			});

			return toProviderSettingsSummary(getSdkProviderSettings(providerId));
		},

		async deleteCustomProvider(input: { providerId: string }): Promise<RuntimeClineProviderSettings> {
			const providerId = input.providerId.trim().toLowerCase();
			if (!providerId) {
				throw new Error("Provider ID cannot be empty.");
			}

			await deleteSdkCustomProvider(providerId);
			return getProviderSettingsSummary();
		},

		saveProviderSettings(input: {
			providerId: string;
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
		}): RuntimeClineProviderSettingsSaveResponse {
			const providerId = input.providerId.trim().toLowerCase();
			if (!providerId) {
				throw new Error("Provider ID cannot be empty.");
			}

			const existingSettings = getSdkProviderSettings(providerId) ?? {
				provider: providerId,
			};
			const nextSettings: SdkProviderSettings = {
				...existingSettings,
				provider: providerId,
			};

			if (input.modelId !== undefined) {
				const modelId = input.modelId?.trim() ?? "";
				if (modelId) {
					nextSettings.model = modelId;
				} else {
					delete nextSettings.model;
				}
			}

			if (input.baseUrl !== undefined) {
				const baseUrl = input.baseUrl?.trim() ?? "";
				if (baseUrl) {
					nextSettings.baseUrl = baseUrl;
				} else {
					delete nextSettings.baseUrl;
				}
			}

			if (input.apiKey !== undefined) {
				const apiKey = input.apiKey?.trim() ?? "";
				if (apiKey) {
					nextSettings.apiKey = apiKey;
				} else {
					delete nextSettings.apiKey;
				}
			}

			if (input.reasoningEffort !== undefined) {
				const nextReasoning = { ...(nextSettings.reasoning ?? {}) };
				if (input.reasoningEffort) {
					nextReasoning.effort = input.reasoningEffort;
				} else {
					delete nextReasoning.effort;
				}
				if (
					nextReasoning.enabled === undefined &&
					nextReasoning.effort === undefined &&
					nextReasoning.budgetTokens === undefined
				) {
					delete nextSettings.reasoning;
				} else {
					nextSettings.reasoning = nextReasoning;
				}
			}

			if (input.region !== undefined) {
				const region = input.region?.trim() ?? "";
				if (region) {
					nextSettings.region = region;
				} else {
					delete nextSettings.region;
				}
			}

			if (input.aws !== undefined) {
				const nextAws = { ...(nextSettings.aws ?? {}) } as NonNullable<SdkProviderSettings["aws"]>;
				if (input.aws.accessKey !== undefined) {
					const accessKey = input.aws.accessKey?.trim() ?? "";
					if (accessKey) nextAws.accessKey = accessKey;
					else delete nextAws.accessKey;
				}
				if (input.aws.secretKey !== undefined) {
					const secretKey = input.aws.secretKey?.trim() ?? "";
					if (secretKey) nextAws.secretKey = secretKey;
					else delete nextAws.secretKey;
				}
				if (input.aws.sessionToken !== undefined) {
					const sessionToken = input.aws.sessionToken?.trim() ?? "";
					if (sessionToken) nextAws.sessionToken = sessionToken;
					else delete nextAws.sessionToken;
				}
				if (input.aws.region !== undefined) {
					const awsRegion = input.aws.region?.trim() ?? "";
					if (awsRegion) nextAws.region = awsRegion;
					else delete nextAws.region;
				}
				if (input.aws.profile !== undefined) {
					const profile = input.aws.profile?.trim() ?? "";
					if (profile) nextAws.profile = profile;
					else delete nextAws.profile;
				}
				if (input.aws.authentication !== undefined) {
					const authentication = input.aws.authentication;
					if (authentication) nextAws.authentication = authentication;
					else delete nextAws.authentication;
				}
				if (input.aws.endpoint !== undefined) {
					const endpoint = input.aws.endpoint?.trim() ?? "";
					if (endpoint) nextAws.endpoint = endpoint;
					else delete nextAws.endpoint;
				}

				if (
					nextAws.accessKey === undefined &&
					nextAws.secretKey === undefined &&
					nextAws.sessionToken === undefined &&
					nextAws.region === undefined &&
					nextAws.profile === undefined &&
					nextAws.authentication === undefined &&
					nextAws.usePromptCache === undefined &&
					nextAws.useCrossRegionInference === undefined &&
					nextAws.useGlobalInference === undefined &&
					nextAws.endpoint === undefined &&
					nextAws.customModelBaseId === undefined
				) {
					delete nextSettings.aws;
				} else {
					nextSettings.aws = nextAws;
				}
			}

			if (input.gcp !== undefined) {
				const nextGcp = { ...(nextSettings.gcp ?? {}) } as NonNullable<SdkProviderSettings["gcp"]>;
				if (input.gcp.projectId !== undefined) {
					const projectId = input.gcp.projectId?.trim() ?? "";
					if (projectId) nextGcp.projectId = projectId;
					else delete nextGcp.projectId;
				}
				if (input.gcp.region !== undefined) {
					const gcpRegion = input.gcp.region?.trim() ?? "";
					if (gcpRegion) nextGcp.region = gcpRegion;
					else delete nextGcp.region;
				}
				if (nextGcp.projectId === undefined && nextGcp.region === undefined) {
					delete nextSettings.gcp;
				} else {
					nextSettings.gcp = nextGcp;
				}
			}

			if (providerId === "vertex") {
				const projectId = nextSettings.gcp?.projectId?.trim() ?? "";
				if (!projectId) {
					throw new Error("Vertex provider requires GCP Project ID.");
				}
				const modelId = nextSettings.model?.trim().toLowerCase() ?? "";
				const isClaudeModel = modelId.includes("claude");
				const resolvedRegion = nextSettings.gcp?.region?.trim() || nextSettings.region?.trim() || "";
				if (isClaudeModel && !resolvedRegion) {
					throw new Error("Vertex Claude models require GCP Region (or Region).");
				}
			}

			if (!isManagedOauthProviderId(providerId)) {
				delete nextSettings.auth;
			}

			saveSdkProviderSettings({
				settings: nextSettings,
				tokenSource: hasOauthAccessToken(nextSettings) ? "oauth" : "manual",
				setLastUsed: true,
			});

			return toProviderSettingsSummary(nextSettings);
		},

		async runOauthLogin(input: {
			providerId: ManagedClineOauthProviderId;
			baseUrl?: string | null;
		}): Promise<RuntimeClineOauthLoginResponse> {
			try {
				const existingSettings = getSdkProviderSettings(input.providerId) ?? {
					provider: input.providerId,
				};
				const baseUrl = input.baseUrl?.trim() || null;
				const credentials = await loginManagedOauthProvider({
					providerId: input.providerId,
					baseUrl,
					oauthProvider: input.providerId,
					callbacks: createRuntimeOauthCallbacks(input.providerId),
				});

				const nextSettings: SdkProviderSettings = {
					...existingSettings,
					provider: input.providerId,
					auth: {
						...(existingSettings.auth ?? {}),
						accessToken: toProviderApiKey(input.providerId, credentials.access),
						refreshToken: credentials.refresh,
						accountId: credentials.accountId ?? undefined,
						expiresAt: normalizeEpochMs(credentials.expires),
					},
				};

				if (baseUrl) {
					nextSettings.baseUrl = baseUrl;
				} else {
					delete nextSettings.baseUrl;
				}

				saveSdkProviderSettings({
					settings: nextSettings,
					tokenSource: "oauth",
					setLastUsed: true,
				});

				return {
					ok: true,
					provider: input.providerId,
					settings: toProviderSettingsSummary(nextSettings),
				};
			} catch (error) {
				return {
					ok: false,
					provider: input.providerId,
					error: toErrorMessage(error),
				};
			}
		},
	};
}
