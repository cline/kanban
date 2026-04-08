// Centralize direct SDK provider imports here.
// The rest of Kanban should talk to the SDK through local service modules so
// auth, catalog, and provider-settings behavior stay behind one boundary.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as ClineCore from "@clinebot/core/node";

import {
	addLocalProvider,
	ClineAccountService,
	type ClineAccountUser,
	type ClineOrganization,
	type CreateMcpToolsOptions,
	createMcpTools,
	DEFAULT_EXTERNAL_IDCS_CLIENT_ID,
	DEFAULT_EXTERNAL_IDCS_SCOPES,
	DEFAULT_EXTERNAL_IDCS_URL,
	DEFAULT_INTERNAL_IDCS_CLIENT_ID,
	DEFAULT_INTERNAL_IDCS_SCOPES,
	DEFAULT_INTERNAL_IDCS_URL,
	ensureCustomProvidersLoaded,
	getValidClineCredentials,
	getValidOcaCredentials,
	getValidOpenAICodexCredentials,
	InMemoryMcpManager,
	LlmsModels,
	LlmsProviders,
	loginClineOAuth,
	loginOcaOAuth,
	loginOpenAICodex,
	type OcaOAuthProviderOptions,
	ProviderSettingsManager,
	type Tool,
} from "@clinebot/core/node";

export type ManagedClineOauthProviderId = "cline" | "oca" | "openai-codex";
export type SdkReasoningEffort = NonNullable<NonNullable<LlmsProviders.ProviderSettings["reasoning"]>["effort"]>;
export const SDK_DEFAULT_PROVIDER_ID = "cline";
export const SDK_DEFAULT_MODEL_ID = LlmsModels.CLINE_DEFAULT_MODEL;

export interface ManagedOauthCredentials {
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
}

export interface ManagedOauthCallbacks {
	onAuth: (input: { url: string; instructions?: string }) => void;
	onPrompt: () => Promise<never>;
	onProgress: () => void;
}

export interface SdkProviderCatalogItem {
	id: string;
	name: string;
	defaultModelId?: string;
	baseUrl?: string;
	env?: string[];
	capabilities?: string[];
}

export interface SdkUserRemoteConfigResponse {
	organizationId: string;
	value: string;
	enabled: boolean;
}

export type SdkProviderModelRecord = Record<string, LlmsProviders.ModelInfo>;

export type SdkProviderSettings = LlmsProviders.ProviderSettings;
export type SdkCustomProviderCapability = "streaming" | "tools" | "reasoning" | "vision" | "prompt-cache";

export interface SaveSdkProviderSettingsInput {
	settings: SdkProviderSettings;
	tokenSource?: "oauth" | "manual";
	setLastUsed?: boolean;
}

export interface AddSdkCustomProviderInput {
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

export interface UpdateSdkCustomProviderInput {
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

type LocalModelsFile = {
	version: 1;
	providers: Record<
		string,
		{
			provider: {
				name: string;
				baseUrl: string;
				defaultModelId?: string;
				capabilities?: SdkCustomProviderCapability[];
				modelsSourceUrl?: string;
			};
			models: Record<string, { id: string; name: string }>;
		}
	>;
};

export type SdkMcpTool = Tool;

export interface SdkMcpServerRegistration {
	name: string;
	disabled?: boolean;
	transport:
		| {
				type: "stdio";
				command: string;
				args?: string[];
				cwd?: string;
				env?: Record<string, string>;
		  }
		| {
				type: "sse";
				url: string;
				headers?: Record<string, string>;
		  }
		| {
				type: "streamableHttp";
				url: string;
				headers?: Record<string, string>;
		  };
}

export interface SdkMcpServerSnapshot {
	name: string;
	status: "disconnected" | "connecting" | "connected";
	disabled: boolean;
	lastError?: string;
	toolCount: number;
	updatedAt: number;
}

export interface SdkMcpServerClient {
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	listTools(): Promise<readonly { name: string; description?: string; inputSchema: Record<string, unknown> }[]>;
	callTool(request: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>;
}

export interface SdkMcpManagerOptions {
	clientFactory:
		| ((registration: SdkMcpServerRegistration) => Promise<SdkMcpServerClient>)
		| ((registration: SdkMcpServerRegistration) => SdkMcpServerClient);
	toolsCacheTtlMs?: number;
}

export interface SdkMcpManager {
	registerServer(registration: SdkMcpServerRegistration): Promise<void>;
	listServers(): readonly SdkMcpServerSnapshot[];
	listTools(
		serverName: string,
	): Promise<readonly { name: string; description?: string; inputSchema: Record<string, unknown> }[]>;
	callTool(request: {
		serverName: string;
		toolName: string;
		arguments?: Record<string, unknown>;
		context?: unknown;
	}): Promise<unknown>;
	dispose(): Promise<void>;
}

export type SdkCreateMcpToolsOptions = CreateMcpToolsOptions;

function buildOcaOauthConfig(baseUrl: string | null | undefined): OcaOAuthProviderOptions | undefined {
	const normalizedBaseUrl = baseUrl?.trim() ?? "";
	if (!normalizedBaseUrl) {
		return undefined;
	}
	return {
		mode: normalizedBaseUrl.includes("code-internal") ? "internal" : "external",
		config: {
			internal: {
				clientId: DEFAULT_INTERNAL_IDCS_CLIENT_ID,
				idcsUrl: DEFAULT_INTERNAL_IDCS_URL,
				scopes: DEFAULT_INTERNAL_IDCS_SCOPES,
				baseUrl: normalizedBaseUrl,
			},
			external: {
				clientId: DEFAULT_EXTERNAL_IDCS_CLIENT_ID,
				idcsUrl: DEFAULT_EXTERNAL_IDCS_URL,
				scopes: DEFAULT_EXTERNAL_IDCS_SCOPES,
				baseUrl: normalizedBaseUrl,
			},
		},
	};
}

export async function refreshManagedOauthCredentials(input: {
	providerId: ManagedClineOauthProviderId;
	currentCredentials: ManagedOauthCredentials;
	baseUrl?: string | null;
	oauthProvider?: string | null;
}): Promise<ManagedOauthCredentials | null> {
	if (input.providerId === "cline") {
		const credentials = await getValidClineCredentials(input.currentCredentials, {
			apiBaseUrl: input.baseUrl?.trim() || "https://api.cline.bot",
			provider: input.oauthProvider?.trim() || undefined,
		});
		return credentials ?? null;
	}

	if (input.providerId === "oca") {
		const credentials = await getValidOcaCredentials(
			input.currentCredentials,
			undefined,
			buildOcaOauthConfig(input.baseUrl),
		);
		return credentials ?? null;
	}

	const credentials = await getValidOpenAICodexCredentials(input.currentCredentials);
	return credentials ?? null;
}

export async function loginManagedOauthProvider(input: {
	providerId: ManagedClineOauthProviderId;
	baseUrl?: string | null;
	oauthProvider?: string | null;
	callbacks: ManagedOauthCallbacks;
}): Promise<ManagedOauthCredentials> {
	if (input.providerId === "cline") {
		return await loginClineOAuth({
			apiBaseUrl: input.baseUrl?.trim() || "https://api.cline.bot",
			provider: input.oauthProvider?.trim() || undefined,
			callbacks: input.callbacks,
		});
	}

	if (input.providerId === "oca") {
		return await loginOcaOAuth({
			...(buildOcaOauthConfig(input.baseUrl) ?? { mode: "external" as const }),
			callbacks: input.callbacks,
		});
	}

	return await loginOpenAICodex({
		...input.callbacks,
		originator: "kanban-runtime",
	});
}

export async function listSdkProviderCatalog(): Promise<SdkProviderCatalogItem[]> {
	return await LlmsModels.getAllProviders();
}

export async function listSdkProviderModels(providerId: string): Promise<SdkProviderModelRecord> {
	return await LlmsModels.getModelsForProvider(providerId);
}

export function supportsSdkModelThinking(modelInfo: LlmsProviders.ModelInfo): boolean {
	return LlmsProviders.supportsModelThinking(modelInfo);
}

const providerManager = new ProviderSettingsManager();

function resolveModelsPath(): string {
	return join(dirname(providerManager.getFilePath()), "models.json");
}

async function readModelsRegistry(): Promise<LocalModelsFile> {
	try {
		const raw = await readFile(resolveModelsPath(), "utf8");
		const parsed = JSON.parse(raw) as Partial<LocalModelsFile>;
		if (parsed.version === 1 && parsed.providers && typeof parsed.providers === "object") {
			return { version: 1, providers: parsed.providers };
		}
	} catch {
		// Fall through.
	}
	return { version: 1, providers: {} };
}

async function writeModelsRegistry(state: LocalModelsFile): Promise<void> {
	await writeFile(resolveModelsPath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function addSdkCustomProvider(input: AddSdkCustomProviderInput): Promise<void> {
	await addLocalProvider(providerManager, {
		providerId: input.providerId,
		name: input.name,
		baseUrl: input.baseUrl,
		apiKey: input.apiKey ?? undefined,
		headers: input.headers,
		timeoutMs: input.timeoutMs,
		models: input.models,
		defaultModelId: input.defaultModelId ?? undefined,
		modelsSourceUrl: input.modelsSourceUrl ?? undefined,
		capabilities: input.capabilities,
	});
	await ensureCustomProvidersLoaded(providerManager);
}

export async function updateSdkCustomProvider(input: UpdateSdkCustomProviderInput): Promise<void> {
	const updateLocalProvider = (
		ClineCore as {
			updateLocalProvider?: (
				manager: ProviderSettingsManager,
				request: {
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
				},
			) => Promise<unknown>;
		}
	).updateLocalProvider;
	if (updateLocalProvider) {
		await updateLocalProvider(providerManager, input);
		return;
	}

	const providerId = input.providerId.trim().toLowerCase();
	const state = await readModelsRegistry();
	const existing = state.providers[providerId];
	if (!existing) {
		throw new Error(`provider "${providerId}" does not exist`);
	}
	const existingSettings = providerManager.getProviderSettings(providerId);
	const existingTokenSource = providerManager.read().providers[providerId]?.tokenSource;
	const wasLastUsed = providerManager.read().lastUsedProvider === providerId;

	const models =
		input.models?.map((model) => model.trim()).filter((model) => model.length > 0) ??
		Object.keys(existing.models)
			.map((model) => model.trim())
			.filter((model) => model.length > 0);
	if (models.length === 0) {
		throw new Error("at least one model is required");
	}

	const nextName = input.name?.trim() || existing.provider.name;
	const nextBaseUrl = input.baseUrl?.trim() || existing.provider.baseUrl;
	const nextDefaultModelId =
		(input.defaultModelId === undefined
			? existing.provider.defaultModelId
			: input.defaultModelId?.trim() || undefined) ?? models[0];
	const nextModelsSourceUrl =
		input.modelsSourceUrl === undefined
			? existing.provider.modelsSourceUrl
			: input.modelsSourceUrl?.trim() || undefined;

	await deleteSdkCustomProvider(providerId);
	await addSdkCustomProvider({
		providerId,
		name: nextName,
		baseUrl: nextBaseUrl,
		apiKey: input.apiKey === undefined ? (existingSettings?.apiKey ?? null) : input.apiKey,
		headers:
			input.headers === undefined
				? ((existingSettings?.headers as Record<string, string> | undefined) ?? undefined)
				: (input.headers ?? undefined),
		timeoutMs:
			input.timeoutMs === undefined
				? typeof existingSettings?.timeout === "number"
					? existingSettings.timeout
					: undefined
				: (input.timeoutMs ?? undefined),
		models,
		defaultModelId: nextDefaultModelId,
		modelsSourceUrl: nextModelsSourceUrl,
		capabilities: input.capabilities ?? existing.provider.capabilities,
	});

	if (existingSettings) {
		providerManager.saveProviderSettings(
			{
				...existingSettings,
				provider: providerId,
				baseUrl: nextBaseUrl,
				model: nextDefaultModelId,
				...(input.apiKey !== undefined ? { apiKey: input.apiKey ?? undefined } : {}),
				...(input.headers !== undefined ? { headers: input.headers ?? undefined } : {}),
				...(input.timeoutMs !== undefined ? { timeout: input.timeoutMs ?? undefined } : {}),
			},
			{
				setLastUsed: wasLastUsed,
				tokenSource: existingTokenSource,
			},
		);
	}
}

export async function deleteSdkCustomProvider(providerId: string): Promise<void> {
	const deleteLocalProvider = (
		ClineCore as {
			deleteLocalProvider?: (manager: ProviderSettingsManager, request: { providerId: string }) => Promise<unknown>;
		}
	).deleteLocalProvider;
	if (deleteLocalProvider) {
		await deleteLocalProvider(providerManager, { providerId });
		return;
	}

	const normalizedProviderId = providerId.trim().toLowerCase();
	if (!normalizedProviderId) {
		throw new Error("providerId is required");
	}

	const state = await readModelsRegistry();
	if (!state.providers[normalizedProviderId]) {
		throw new Error(`provider "${normalizedProviderId}" does not exist`);
	}
	delete state.providers[normalizedProviderId];
	await writeModelsRegistry(state);
	LlmsModels.unregisterProvider(normalizedProviderId);

	const settingsState = providerManager.read();
	delete settingsState.providers[normalizedProviderId];
	if (settingsState.lastUsedProvider === normalizedProviderId) {
		delete settingsState.lastUsedProvider;
	}
	providerManager.write(settingsState);
}

export function getSdkProviderSettings(providerId: string): SdkProviderSettings | null {
	return (providerManager.getProviderSettings(providerId) as SdkProviderSettings | undefined) ?? null;
}

export function getLastUsedSdkProviderSettings(): SdkProviderSettings | null {
	return (providerManager.getLastUsedProviderSettings() as SdkProviderSettings | undefined) ?? null;
}

export function saveSdkProviderSettings(input: SaveSdkProviderSettingsInput): void {
	const settings: SdkProviderSettings = {
		...input.settings,
		provider: input.settings.provider.trim(),
	};
	if (settings.model !== undefined) {
		const model = settings.model.trim();
		if (!model) {
			delete settings.model;
		} else {
			settings.model = model;
		}
	}
	if (settings.baseUrl !== undefined) {
		const baseUrl = settings.baseUrl.trim();
		if (!baseUrl) {
			delete settings.baseUrl;
		} else {
			settings.baseUrl = baseUrl;
			if (settings.provider === "oca") {
				settings.oca = {
					mode: baseUrl.includes("code-internal") ? "internal" : "external",
				};
			}
		}
	}
	if (settings.apiKey !== undefined) {
		const apiKey = settings.apiKey.trim();
		if (!apiKey) {
			delete settings.apiKey;
		} else {
			settings.apiKey = apiKey;
		}
	}
	if (settings.reasoning) {
		const reasoning = { ...settings.reasoning };
		if (typeof reasoning.effort === "string") {
			const effort = reasoning.effort.trim();
			if (!effort) {
				delete reasoning.effort;
			} else {
				reasoning.effort = effort as SdkReasoningEffort;
			}
		}
		if (reasoning.enabled === undefined && reasoning.effort === undefined && reasoning.budgetTokens === undefined) {
			delete settings.reasoning;
		} else {
			settings.reasoning = reasoning;
		}
	}
	if (settings.auth) {
		const auth = { ...settings.auth };
		if (auth.accountId !== undefined && auth.accountId !== null) {
			const accountId = auth.accountId.trim();
			auth.accountId = accountId || undefined;
		}
		settings.auth = auth;
	}

	providerManager.saveProviderSettings(settings, {
		setLastUsed: input.setLastUsed,
		tokenSource: input.tokenSource,
	});
}

export function createSdkInMemoryMcpManager(options: SdkMcpManagerOptions): SdkMcpManager {
	const managerConstructor = InMemoryMcpManager;
	if (!managerConstructor) {
		throw new Error("InMemoryMcpManager is not available from @clinebot/core/node.");
	}
	return new managerConstructor(options);
}

export async function createSdkMcpTools(options: SdkCreateMcpToolsOptions): Promise<SdkMcpTool[]> {
	return await createMcpTools(options);
}

type ApiRequestParams = {
	apiBaseUrl: string;
	accessToken: string;
};

export async function fetchSdkClineAccountProfile(input: ApiRequestParams): Promise<ClineAccountUser> {
	const accountService = new ClineAccountService({
		apiBaseUrl: input.apiBaseUrl,
		getAuthToken: async () => input.accessToken,
	});
	const me = await accountService.fetchMe();
	return me;
}

export async function fetchSdkOrgData(input: ApiRequestParams & { organizatinId: string }): Promise<ClineOrganization> {
	const accountService = new ClineAccountService({
		apiBaseUrl: input.apiBaseUrl,
		getAuthToken: async () => input.accessToken,
	});
	return await accountService.fetchOrganization(input.organizatinId);
}

export async function fetchSdkFeaturebaseToken(input: ApiRequestParams): Promise<{ featurebaseJwt: string }> {
	const accountService = new ClineAccountService({
		apiBaseUrl: input.apiBaseUrl,
		getAuthToken: async () => input.accessToken,
	});
	const response = await accountService.fetchFeaturebaseToken();
	if (!response) {
		throw new Error("Failed to fetch Featurebase token from SDK");
	}
	return { featurebaseJwt: response.featurebaseJwt };
}

export async function fetchSdkClineUserRemoteConfig(
	input: ApiRequestParams,
): Promise<SdkUserRemoteConfigResponse | null> {
	const accountServiceConstructor = ClineAccountService;
	if (!accountServiceConstructor) {
		throw new Error("ClineAccountService is not available from @clinebot/core/node.");
	}
	const accountService = new accountServiceConstructor({
		apiBaseUrl: input.apiBaseUrl,
		getAuthToken: async () => input.accessToken,
	});
	return await accountService.fetchRemoteConfig();
}
