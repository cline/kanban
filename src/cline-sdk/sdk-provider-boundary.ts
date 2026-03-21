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
import { models as llmsModels } from "@clinebot/llms";

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
