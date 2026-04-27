import { rm } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const clineAccountMocks = vi.hoisted(() => ({
	fetchMe: vi.fn(),
	fetchBalance: vi.fn(),
	fetchOrganizationBalance: vi.fn(),
	switchAccount: vi.fn(),
	fetchRemoteConfig: vi.fn(),
	fetchOrganization: vi.fn(),
	fetchFeaturebaseToken: vi.fn(),
	constructedOptions: [] as Array<{ apiBaseUrl: string; getAuthToken: () => Promise<string | undefined | null> }>,
}));

const oauthMocks = vi.hoisted(() => ({
	saveProviderSettings: vi.fn(),
	getProviderSettings: vi.fn(),
	getLastUsedProviderSettings: vi.fn(),
}));

const llmsModelMocks = vi.hoisted(() => ({
	getAllProviders: vi.fn(),
	getModelsForProvider: vi.fn(),
}));

const localProviderMocks = vi.hoisted(() => ({
	getLocalProviderModels: vi.fn(),
}));

vi.mock("@clinebot/core", () => ({
	addLocalProvider: vi.fn(),
	ensureCustomProvidersLoaded: vi.fn(),
	getLocalProviderModels: localProviderMocks.getLocalProviderModels,
	getValidClineCredentials: vi.fn(),
	getValidOcaCredentials: vi.fn(),
	getValidOpenAICodexCredentials: vi.fn(),
	loginClineOAuth: vi.fn(),
	loginOcaOAuth: vi.fn(),
	loginOpenAICodex: vi.fn(),
	resolveDefaultMcpSettingsPath: vi.fn(),
	loadMcpSettingsFile: vi.fn(),
	ClineAccountService: class {
		constructor(options: { apiBaseUrl: string; getAuthToken: () => Promise<string | undefined | null> }) {
			clineAccountMocks.constructedOptions.push(options);
		}
		fetchMe = clineAccountMocks.fetchMe;
		fetchBalance = clineAccountMocks.fetchBalance;
		fetchOrganizationBalance = clineAccountMocks.fetchOrganizationBalance;
		switchAccount = clineAccountMocks.switchAccount;
		fetchRemoteConfig = clineAccountMocks.fetchRemoteConfig;
		fetchOrganization = clineAccountMocks.fetchOrganization;
		fetchFeaturebaseToken = clineAccountMocks.fetchFeaturebaseToken;
	},
	ProviderSettingsManager: class {
		saveProviderSettings = oauthMocks.saveProviderSettings;
		getProviderSettings = oauthMocks.getProviderSettings;
		getLastUsedProviderSettings = oauthMocks.getLastUsedProviderSettings;
		getProviderConfig = vi.fn((providerId: string) => {
			const settings = oauthMocks.getProviderSettings(providerId);
			if (!settings) {
				return undefined;
			}
			return {
				providerId: settings.provider,
				apiKey: settings.apiKey,
				modelId: settings.model,
				baseUrl: settings.baseUrl,
			};
		});
		getFilePath = vi.fn(() => "/tmp/provider-settings.json");
		read = vi.fn(() => ({ providers: {} }));
		write = vi.fn();
	},
	Llms: {
		getAllProviders: llmsModelMocks.getAllProviders,
		getModelsForProvider: llmsModelMocks.getModelsForProvider,
	},
	LlmsModels: {
		CLINE_DEFAULT_MODEL: "anthropic/claude-sonnet-4.6",
		getAllProviders: llmsModelMocks.getAllProviders,
		getModelsForProvider: llmsModelMocks.getModelsForProvider,
	},
	LlmsProviders: {
		supportsModelThinking: vi.fn(() => false),
	},
	InMemoryMcpManager: class {},
	createMcpTools: vi.fn(async () => []),
	DEFAULT_EXTERNAL_IDCS_CLIENT_ID: "",
	DEFAULT_EXTERNAL_IDCS_SCOPES: "",
	DEFAULT_EXTERNAL_IDCS_URL: "",
	DEFAULT_INTERNAL_IDCS_CLIENT_ID: "",
	DEFAULT_INTERNAL_IDCS_SCOPES: "",
	DEFAULT_INTERNAL_IDCS_URL: "",
}));

vi.mock("../../../src/server/browser.js", () => ({
	openInBrowser: vi.fn(),
}));

import { createClineProviderService } from "../../../src/cline-sdk/cline-provider-service";
import { resetClineProviderModelsCacheForTests } from "../../../src/cline-sdk/cline-provider-models";
import { resetClineRecommendedModelsCacheForTests } from "../../../src/cline-sdk/cline-recommended-models";

const CLINE_PROVIDER_MODELS_CACHE_PATH = join("/tmp", "cline-provider-models.json");
const CLINE_RECOMMENDED_MODELS_CACHE_PATH = join("/tmp", "cline-recommended-models.json");

function setSelectedProviderSettings(
	settings: {
		provider: string;
		model?: string;
		baseUrl?: string;
		apiKey?: string;
		auth?: {
			accessToken?: string;
			refreshToken?: string;
			accountId?: string;
			expiresAt?: number;
		};
	} | null,
): void {
	oauthMocks.getLastUsedProviderSettings.mockReturnValue(settings ?? undefined);
	oauthMocks.getProviderSettings.mockImplementation((providerId: string) =>
		settings && settings.provider === providerId ? settings : undefined,
	);
}

describe("getClineAccountBalance", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clineAccountMocks.constructedOptions = [];
	});

	it("returns all-null when no provider settings are configured", async () => {
		setSelectedProviderSettings(null);
		const service = createClineProviderService();
		const result = await service.getClineAccountBalance();
		expect(result).toEqual({ balance: null, activeAccountLabel: null, activeOrganizationId: null });
	});

	it("returns all-null when provider is not cline", async () => {
		setSelectedProviderSettings({ provider: "anthropic", apiKey: "sk-test" });
		const service = createClineProviderService();
		const result = await service.getClineAccountBalance();
		expect(result).toEqual({ balance: null, activeAccountLabel: null, activeOrganizationId: null });
	});

	it("returns all-null when no access token is present", async () => {
		setSelectedProviderSettings({ provider: "cline", auth: {} });
		const service = createClineProviderService();
		const result = await service.getClineAccountBalance();
		expect(result).toEqual({ balance: null, activeAccountLabel: null, activeOrganizationId: null });
	});

	it("returns personal balance when no active org", async () => {
		setSelectedProviderSettings({
			provider: "cline",
			auth: { accessToken: "test-token" },
		});
		clineAccountMocks.fetchMe.mockResolvedValue({
			id: "user-1",
			email: "test@example.com",
			displayName: "Test User",
			organizations: [],
		});
		clineAccountMocks.fetchBalance.mockResolvedValue({
			balance: 5_000_000,
			userId: "user-1",
		});

		const service = createClineProviderService();
		const result = await service.getClineAccountBalance();

		expect(result).toEqual({
			balance: 5_000_000,
			activeAccountLabel: "Personal",
			activeOrganizationId: null,
		});
	});

	it("returns org balance when an active org exists", async () => {
		setSelectedProviderSettings({
			provider: "cline",
			auth: { accessToken: "test-token" },
		});
		clineAccountMocks.fetchMe.mockResolvedValue({
			id: "user-1",
			email: "test@example.com",
			displayName: "Test User",
			organizations: [
				{ organizationId: "org-1", name: "Test Org", active: true, roles: ["admin"], memberId: "m-1" },
			],
		});
		clineAccountMocks.fetchOrganizationBalance.mockResolvedValue({
			balance: 26_617_620,
			organizationId: "org-1",
		});

		const service = createClineProviderService();
		const result = await service.getClineAccountBalance();

		expect(result).toEqual({
			balance: 26_617_620,
			activeAccountLabel: "Test Org",
			activeOrganizationId: "org-1",
		});
	});

	it("returns all-null without error when fetch fails and OAuth refresh is unavailable", async () => {
		setSelectedProviderSettings({
			provider: "cline",
			auth: { accessToken: "test-token" },
		});
		clineAccountMocks.fetchMe.mockRejectedValue(new Error("Network error"));

		const service = createClineProviderService();
		const result = await service.getClineAccountBalance();

		// First call fails, OAuth refresh returns no settings, so service returns all-null (no error field).
		expect(result.balance).toBeNull();
		expect(result.activeAccountLabel).toBeNull();
		expect(result.activeOrganizationId).toBeNull();
	});
});

describe("getProviderModels", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		resetClineProviderModelsCacheForTests();
		resetClineRecommendedModelsCacheForTests();
		vi.unstubAllGlobals();
		await rm(CLINE_PROVIDER_MODELS_CACHE_PATH, { force: true });
		await rm(CLINE_RECOMMENDED_MODELS_CACHE_PATH, { force: true });
	});

	it("merges missing featured models back into the cline model list", async () => {
		setSelectedProviderSettings({
			provider: "cline",
			baseUrl: "https://api.cline.bot",
		});
		const fetchMock = vi.fn(async (input: string) => {
			if (input.endsWith("/api/v1/ai/cline/models")) {
				return {
					ok: true,
					json: async () => ({
						data: [
							{ id: "anthropic/claude-opus-4.7", name: "Claude Opus 4.7", supported_parameters: ["reasoning"] },
							{ id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
						],
					}),
				};
			}
			return {
				ok: true,
				json: async () => ({
					recommended: [{ id: "anthropic/claude-sonnet-4.6" }, { id: "anthropic/claude-opus-4.7" }],
					free: [{ id: "bytedance/seed-2-0-pro" }],
				}),
			};
		});
		vi.stubGlobal("fetch", fetchMock);

		const service = createClineProviderService();
		const result = await service.getProviderModels("cline");

		expect(fetchMock).toHaveBeenCalledWith("https://api.cline.bot/api/v1/ai/cline/recommended-models");
		expect(fetchMock).toHaveBeenCalledWith("https://api.cline.bot/api/v1/ai/cline/models");
		expect(localProviderMocks.getLocalProviderModels).not.toHaveBeenCalled();
		expect(result.models).toEqual([
			{
				id: "bytedance/seed-2-0-pro",
				name: "bytedance/seed-2-0-pro",
				freeRank: 0,
			},
			{
				id: "anthropic/claude-opus-4.7",
				name: "Claude Opus 4.7",
				supportsReasoningEffort: true,
				recommendedRank: 1,
			},
			{
				id: "anthropic/claude-sonnet-4.6",
				name: "Claude Sonnet 4.6",
				recommendedRank: 0,
			},
		]);
	});

	it("does not duplicate a configured model when featured backfill already added it", async () => {
		setSelectedProviderSettings({
			provider: "cline",
			baseUrl: "https://api.cline.bot",
			model: "bytedance/seed-2-0-pro",
		});
		const fetchMock = vi.fn(async (input: string) => {
			if (input.endsWith("/api/v1/ai/cline/models")) {
				return {
					ok: true,
					json: async () => ({
						data: [{ id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6" }],
					}),
				};
			}
			return {
				ok: true,
				json: async () => ({
					recommended: [{ id: "anthropic/claude-sonnet-4.6" }],
					free: [{ id: "bytedance/seed-2-0-pro", name: "seed-2-0-pro" }],
				}),
			};
		});
		vi.stubGlobal("fetch", fetchMock);

		const service = createClineProviderService();
		const result = await service.getProviderModels("cline");

		expect(result.models.filter((model) => model.id === "bytedance/seed-2-0-pro")).toEqual([
			{
				id: "bytedance/seed-2-0-pro",
				name: "seed-2-0-pro",
				freeRank: 0,
			},
		]);
	});

	it("falls back to the bundled recommended model IDs when the endpoint fails", async () => {
		setSelectedProviderSettings({
			provider: "cline",
			baseUrl: "https://api.cline.bot",
		});
		localProviderMocks.getLocalProviderModels.mockResolvedValue({
			providerId: "cline",
			models: [
				{ id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
				{ id: "openai/gpt-5.3-codex", name: "GPT-5.3 Codex" },
				{ id: "openai/gpt-5.2", name: "GPT-5.2" },
			],
		});
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));

		const service = createClineProviderService();
		const result = await service.getProviderModels("cline");

		expect(result.models).toEqual([
			{
				id: "google/gemini-3.1-pro-preview",
				name: "Gemini 3.1 Pro Preview",
				recommendedRank: 0,
			},
			{
				id: "openai/gpt-5.2",
				name: "GPT-5.2",
			},
			{
				id: "openai/gpt-5.3-codex",
				name: "GPT-5.3 Codex",
				recommendedRank: 3,
			},
		]);
	});
});

describe("getClineAccountOrganizations", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clineAccountMocks.constructedOptions = [];
	});

	it("returns empty array when no provider settings", async () => {
		setSelectedProviderSettings(null);
		const service = createClineProviderService();
		const result = await service.getClineAccountOrganizations();
		expect(result).toEqual({ organizations: [] });
	});

	it("returns empty array for non-cline provider", async () => {
		setSelectedProviderSettings({ provider: "openai", apiKey: "sk-test" });
		const service = createClineProviderService();
		const result = await service.getClineAccountOrganizations();
		expect(result).toEqual({ organizations: [] });
	});

	it("returns organizations from profile", async () => {
		setSelectedProviderSettings({
			provider: "cline",
			auth: { accessToken: "test-token" },
		});
		clineAccountMocks.fetchMe.mockResolvedValue({
			id: "user-1",
			email: "test@example.com",
			displayName: "Test User",
			organizations: [
				{ organizationId: "org-1", name: "Org A", active: true, roles: ["owner"], memberId: "m-1" },
				{ organizationId: "org-2", name: "Org B", active: false, roles: ["member"], memberId: "m-2" },
			],
		});

		const service = createClineProviderService();
		const result = await service.getClineAccountOrganizations();

		expect(result.organizations).toHaveLength(2);
		expect(result.organizations[0]).toEqual({
			organizationId: "org-1",
			name: "Org A",
			active: true,
			roles: ["owner"],
		});
		expect(result.organizations[1]).toEqual({
			organizationId: "org-2",
			name: "Org B",
			active: false,
			roles: ["member"],
		});
	});
});

describe("switchClineAccount", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clineAccountMocks.constructedOptions = [];
	});

	it("returns ok true on successful switch", async () => {
		setSelectedProviderSettings({
			provider: "cline",
			auth: { accessToken: "test-token" },
		});
		clineAccountMocks.switchAccount.mockResolvedValue(undefined);

		const service = createClineProviderService();
		const result = await service.switchClineAccount("org-1");

		expect(result).toEqual({ ok: true });
		expect(clineAccountMocks.switchAccount).toHaveBeenCalledWith("org-1");
	});

	it("returns ok true when switching to personal (null)", async () => {
		setSelectedProviderSettings({
			provider: "cline",
			auth: { accessToken: "test-token" },
		});
		clineAccountMocks.switchAccount.mockResolvedValue(undefined);

		const service = createClineProviderService();
		const result = await service.switchClineAccount(null);

		expect(result).toEqual({ ok: true });
		expect(clineAccountMocks.switchAccount).toHaveBeenCalledWith(undefined);
	});

	it("returns error on failure", async () => {
		setSelectedProviderSettings({
			provider: "cline",
			auth: { accessToken: "test-token" },
		});
		clineAccountMocks.switchAccount.mockRejectedValue(new Error("Switch failed"));

		const service = createClineProviderService();
		const result = await service.switchClineAccount("org-1");

		expect(result.ok).toBe(false);
		expect(result.error).toBeDefined();
	});
});
