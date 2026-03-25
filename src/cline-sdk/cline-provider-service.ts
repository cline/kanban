// Kanban-facing facade over the SDK-backed provider store.
// It resolves provider settings, model catalogs, OAuth flows, and launch
// config without leaking SDK details into runtime-api.ts or the UI.
import type {
	RuntimeClineAccountProfileResponse,
	RuntimeClineOauthLoginResponse,
	RuntimeClineProviderCatalogItem,
	RuntimeClineProviderCatalogResponse,
	RuntimeClineProviderModel,
	RuntimeClineProviderModelsResponse,
	RuntimeClineProviderSettings,
	RuntimeClineProviderSettingsSaveResponse,
} from "../core/api-contract.js";
import { openInBrowser } from "../server/browser.js";
import {
	fetchSdkClineAccountProfile,
	type ManagedClineOauthProviderId,
	type SdkProviderSettings,
	getLastUsedSdkProviderSettings,
	getSdkProviderSettings,
	listSdkProviderCatalog,
	listSdkProviderModels,
	loginManagedOauthProvider,
	refreshManagedOauthCredentials,
	saveSdkProviderSettings,
} from "./sdk-provider-boundary.js";

const WORKOS_TOKEN_PREFIX = "workos:";
const DEFAULT_CLINE_API_BASE_URL = "https://api.cline.bot";
const MANAGED_PROVIDER_ENV_KEYS: Record<ManagedClineOauthProviderId, readonly string[]> = {
	cline: ["CLINE_API_KEY"],
	oca: ["OCA_API_KEY"],
	"openai-codex": [],
};

export interface ResolvedClineLaunchConfig {
	providerId: string;
	modelId: string | null;
	apiKey: string | null;
	baseUrl: string | null;
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
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

function toRuntimeProviderModel(
	modelId: string,
	modelInfo: { name?: string; capabilities?: string[] },
): RuntimeClineProviderModel {
	const capabilities = new Set(modelInfo.capabilities ?? []);
	const supportsVision = capabilities.has("images");
	const supportsAttachments = capabilities.has("files") || supportsVision;
	return {
		id: modelId,
		name: modelInfo.name?.trim() || modelId,
		supportsVision: supportsVision || undefined,
		supportsAttachments: supportsAttachments || undefined,
	};
}

function createEmptyProviderSettingsSummary(): RuntimeClineProviderSettings {
	return {
		providerId: null,
		modelId: null,
		baseUrl: null,
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
		apiKeyConfigured: Boolean(resolveVisibleApiKey(settings)),
		oauthProvider,
		oauthAccessTokenConfigured: hasOauthAccessToken(settings),
		oauthRefreshTokenConfigured: hasOauthRefreshToken(settings),
		oauthAccountId: settings.auth?.accountId?.trim() || null,
		oauthExpiresAt: toResponseExpirySeconds(settings.auth?.expiresAt),
	};
}

function getSelectedProviderSettings(): SdkProviderSettings | null {
	return getLastUsedSdkProviderSettings();
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
				modelId: resolvedSettings.model?.trim() || null,
				apiKey,
				baseUrl: resolvedSettings.baseUrl?.trim() || null,
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
									.map(([modelId, modelInfo]) => {
										const parsedModelInfo =
											typeof modelInfo === "object" && modelInfo !== null
												? (modelInfo as {
														name?: unknown;
														capabilities?: unknown;
													})
												: null;
										return toRuntimeProviderModel(modelId, {
											name: typeof parsedModelInfo?.name === "string" ? parsedModelInfo.name : undefined,
											capabilities: Array.isArray(parsedModelInfo?.capabilities)
												? parsedModelInfo.capabilities.filter(
														(value): value is string => typeof value === "string",
													)
												: undefined,
										});
									})
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

		saveProviderSettings(input: {
			providerId: string;
			modelId?: string | null;
			apiKey?: string | null;
			baseUrl?: string | null;
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
