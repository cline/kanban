// Centralize direct SDK provider imports here.
// The rest of Kanban should talk to the SDK through local service modules so
// auth, catalog, and provider-settings behavior stay behind one boundary.
import {
	getValidClineCredentials,
	getValidOcaCredentials,
	getValidOpenAICodexCredentials,
	loginClineOAuth,
	loginOcaOAuth,
	loginOpenAICodex,
	ProviderSettingsManager,
} from "@clinebot/core/node";
import { LlmsModels as llmsModels } from "@clinebot/llms";
import { createMcpTools, type CreateMcpToolsOptions, type Tool } from "@clinebot/agents";
import * as coreNodeModule from "@clinebot/core/node";

export type ManagedClineOauthProviderId = "cline" | "oca" | "openai-codex";

export interface ManagedOauthCredentials {
	access: string;
	refresh: string;
	expires: number;
	accountId?: string | null;
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
	capabilities?: string[];
}

export interface SdkClineAccountProfile {
	id: string;
	email: string;
	displayName: string;
}

export type SdkProviderModelRecord = Record<
	string,
	{ name?: string; capabilities?: string[] } | unknown
>;

export interface SdkProviderSettings {
	provider: string;
	model?: string;
	baseUrl?: string;
	apiKey?: string;
	oca?: {
		mode?: "internal" | "external";
	};
	auth?: {
		apiKey?: string;
		accessToken?: string;
		refreshToken?: string;
		accountId?: string | null;
		expiresAt?: number;
	};
}

export interface SaveSdkProviderSettingsInput {
	settings: SdkProviderSettings;
	tokenSource?: "oauth" | "manual";
	setLastUsed?: boolean;
}

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
	listTools(serverName: string): Promise<readonly { name: string; description?: string; inputSchema: Record<string, unknown> }[]>;
	callTool(request: {
		serverName: string;
		toolName: string;
		arguments?: Record<string, unknown>;
		context?: unknown;
	}): Promise<unknown>;
	dispose(): Promise<void>;
}

export type SdkCreateMcpToolsOptions = CreateMcpToolsOptions;

function buildOcaOauthConfig(baseUrl: string | null | undefined):
	| {
			mode: "internal" | "external";
			config: {
				internal: { baseUrl: string };
				external: { baseUrl: string };
			};
	  }
	| undefined {
	const normalizedBaseUrl = baseUrl?.trim() ?? "";
	if (!normalizedBaseUrl) {
		return undefined;
	}
	return {
		mode: normalizedBaseUrl.includes("code-internal") ? "internal" : "external",
		config: {
			internal: { baseUrl: normalizedBaseUrl },
			external: { baseUrl: normalizedBaseUrl },
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
		const credentials = await getValidClineCredentials(
			input.currentCredentials,
			{
				apiBaseUrl: input.baseUrl?.trim() || "https://api.cline.bot",
				provider: input.oauthProvider?.trim() || undefined,
			},
		);
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

	const credentials = await getValidOpenAICodexCredentials(
		input.currentCredentials,
	);
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

export async function listSdkProviderCatalog(): Promise<
	SdkProviderCatalogItem[]
> {
	return await llmsModels.getAllProviders();
}

export async function listSdkProviderModels(
	providerId: string,
): Promise<SdkProviderModelRecord> {
	return await llmsModels.getModelsForProvider(providerId);
}

const providerManager = new ProviderSettingsManager();

export function getSdkProviderSettings(
	providerId: string,
): SdkProviderSettings | null {
	return (
		(providerManager.getProviderSettings(providerId) as
			| SdkProviderSettings
			| undefined) ?? null
	);
}

export function getLastUsedSdkProviderSettings(): SdkProviderSettings | null {
	return (
		(providerManager.getLastUsedProviderSettings() as
			| SdkProviderSettings
			| undefined) ?? null
	);
}

export function saveSdkProviderSettings(
	input: SaveSdkProviderSettingsInput,
): void {
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
	type InMemoryMcpManagerConstructor = new (options: SdkMcpManagerOptions) => SdkMcpManager;
	const managerConstructor = (coreNodeModule as unknown as { InMemoryMcpManager: InMemoryMcpManagerConstructor })
		.InMemoryMcpManager;
	if (!managerConstructor) {
		throw new Error("InMemoryMcpManager is not available from @clinebot/core/node.");
	}
	return new managerConstructor(options);
}

export async function createSdkMcpTools(options: SdkCreateMcpToolsOptions): Promise<SdkMcpTool[]> {
	return await createMcpTools(options);
}

export async function fetchSdkClineAccountProfile(input: {
	apiBaseUrl: string;
	accessToken: string;
}): Promise<SdkClineAccountProfile> {
	type ClineAccountServiceConstructor = new (options: {
		apiBaseUrl: string;
		getAuthToken: () => Promise<string | undefined | null>;
	}) => {
		fetchMe(): Promise<{ id: string; email: string; displayName: string }>;
	};
	const accountServiceConstructor = (coreNodeModule as unknown as { ClineAccountService?: ClineAccountServiceConstructor })
		.ClineAccountService;
	if (!accountServiceConstructor) {
		throw new Error("ClineAccountService is not available from @clinebot/core/node.");
	}
	const accountService = new accountServiceConstructor({
		apiBaseUrl: input.apiBaseUrl,
		getAuthToken: async () => input.accessToken,
	});
	const me = await accountService.fetchMe();
	return {
		id: me.id,
		email: me.email,
		displayName: me.displayName,
	};
}
