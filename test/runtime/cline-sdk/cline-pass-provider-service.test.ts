import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clineAccountMocks = vi.hoisted(() => ({
	fetchMe: vi.fn(),
	fetchBalance: vi.fn(),
	fetchOrganizationBalance: vi.fn(),
	switchAccount: vi.fn(),
	fetchRemoteConfig: vi.fn(),
	fetchOrganization: vi.fn(),
	fetchFeaturebaseToken: vi.fn(),
}));

const oauthMocks = vi.hoisted(() => ({
	saveProviderSettings: vi.fn(),
	getProviderSettings: vi.fn(),
	getLastUsedProviderSettings: vi.fn(),
	getValidClineCredentials: vi.fn(),
	loginClineOAuth: vi.fn(),
}));

const llmsModelMocks = vi.hoisted(() => ({
	getAllProviders: vi.fn(),
	getModelsForProvider: vi.fn(),
	resolveProviderModelCatalogKeys: vi.fn((providerId: string) => [providerId]),
}));

const localProviderMocks = vi.hoisted(() => ({
	getLocalProviderModels: vi.fn(),
	resolveProviderConfig: vi.fn(),
}));

vi.mock("@clinebot/core", () => ({
	addLocalProvider: vi.fn(),
	ensureCustomProvidersLoaded: vi.fn(),
	getLocalProviderModels: localProviderMocks.getLocalProviderModels,
	resolveProviderConfig: localProviderMocks.resolveProviderConfig,
	getValidClineCredentials: oauthMocks.getValidClineCredentials,
	getValidOcaCredentials: vi.fn(),
	getValidOpenAICodexCredentials: vi.fn(),
	loginClineOAuth: oauthMocks.loginClineOAuth,
	loginOcaOAuth: vi.fn(),
	loginOpenAICodex: vi.fn(),
	resolveDefaultMcpSettingsPath: vi.fn(),
	resolveClineDataDir: vi.fn(() => "/tmp/cline"),
	loadMcpSettingsFile: vi.fn(),
	DEFAULT_MODELS_CATALOG_URL: "https://models.dev/api.json",
	ClineAccountService: class {
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
		getProviderConfig = vi.fn(() => undefined);
		getFilePath = vi.fn(() => "/tmp/provider-settings.json");
		read = vi.fn(() => ({ providers: {} }));
		write = vi.fn();
	},
	Llms: {
		getAllProviders: llmsModelMocks.getAllProviders,
		getModelsForProvider: llmsModelMocks.getModelsForProvider,
		resolveProviderModelCatalogKeys: llmsModelMocks.resolveProviderModelCatalogKeys,
	},
	LlmsModels: {
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

const CLINE_SDK_PROVIDER = {
	id: "cline",
	name: "Cline",
	defaultModelId: "anthropic/claude-sonnet-4.6",
	baseUrl: "https://api.cline.bot/api/v1",
	env: ["CLINE_API_KEY"],
	capabilities: ["reasoning", "prompt-cache", "tools", "oauth"],
};

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

function stubModelsCatalogFetch(): ReturnType<typeof vi.fn<typeof fetch>> {
	const fetchMock = vi.fn<typeof fetch>(async () => {
		return new Response(
			JSON.stringify({
				"cline-pass": {
					id: "cline-pass",
					name: "ClinePass",
					api: "https://api.cline.bot/api/v1",
					models: {
						"cline-pass/glm-5.2": {
							id: "cline-pass/glm-5.2",
							name: "GLM-5.2",
							reasoning: true,
							attachment: false,
							modalities: { input: ["text"] },
						},
						"cline-pass/kimi-k3": {
							id: "cline-pass/kimi-k3",
							name: "Kimi K3",
							reasoning: false,
							attachment: true,
							modalities: { input: ["text", "image"] },
						},
					},
				},
				anthropic: { models: {} },
			}),
			{ status: 200 },
		);
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

beforeEach(() => {
	vi.clearAllMocks();
	llmsModelMocks.getAllProviders.mockResolvedValue([CLINE_SDK_PROVIDER]);
	localProviderMocks.getLocalProviderModels.mockResolvedValue({ providerId: "cline-pass", models: [] });
	localProviderMocks.resolveProviderConfig.mockResolvedValue(undefined);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("getProviderCatalog with ClinePass", () => {
	it("offers ClinePass even though the bundled SDK catalog has no entry for it", async () => {
		setSelectedProviderSettings(null);

		const result = await createClineProviderService().getProviderCatalog();
		const clinePass = result.providers.find((provider) => provider.id === "cline-pass");

		expect(clinePass).toEqual({
			id: "cline-pass",
			name: "ClinePass",
			oauthSupported: true,
			enabled: false,
			defaultModelId: "cline-pass/glm-5.2",
			baseUrl: "https://api.cline.bot/api/v1",
			supportsBaseUrl: true,
			env: ["CLINE_API_KEY"],
		});
	});

	it("marks ClinePass as the enabled provider when it is the saved selection", async () => {
		setSelectedProviderSettings({ provider: "cline-pass", model: "cline-pass/glm-5.2" });

		const result = await createClineProviderService().getProviderCatalog();
		const clinePassEntries = result.providers.filter((provider) => provider.id === "cline-pass");

		expect(clinePassEntries).toHaveLength(1);
		expect(clinePassEntries[0]?.enabled).toBe(true);
		expect(clinePassEntries[0]?.name).toBe("ClinePass");
	});

	it("defers to the SDK once it registers ClinePass itself", async () => {
		llmsModelMocks.getAllProviders.mockResolvedValue([
			CLINE_SDK_PROVIDER,
			{
				id: "cline-pass",
				name: "ClinePass (SDK)",
				defaultModelId: "cline-pass/from-sdk",
				baseUrl: "https://api.cline.bot/api/v1",
				env: ["CLINE_API_KEY"],
				capabilities: ["oauth"],
			},
		]);
		setSelectedProviderSettings(null);

		const result = await createClineProviderService().getProviderCatalog();
		const clinePassEntries = result.providers.filter((provider) => provider.id === "cline-pass");

		expect(clinePassEntries).toHaveLength(1);
		expect(clinePassEntries[0]?.name).toBe("ClinePass (SDK)");
		expect(clinePassEntries[0]?.defaultModelId).toBe("cline-pass/from-sdk");
	});
});

describe("getProviderModels for ClinePass", () => {
	it("lists the ClinePass models published by the model catalog", async () => {
		setSelectedProviderSettings({ provider: "cline-pass", model: "cline-pass/glm-5.2" });
		const fetchMock = stubModelsCatalogFetch();

		const result = await createClineProviderService().getProviderModels("cline-pass");

		expect(fetchMock).toHaveBeenCalledWith(
			"https://models.dev/api.json",
			expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) }),
		);
		expect(result.models).toEqual([
			{ id: "cline-pass/glm-5.2", name: "GLM-5.2", supportsReasoningEffort: true },
			{
				id: "cline-pass/kimi-k3",
				name: "Kimi K3",
				supportsVision: true,
				supportsAttachments: true,
			},
		]);
	});

	it("falls back to the saved model when the catalog cannot be reached", async () => {
		setSelectedProviderSettings({ provider: "cline-pass", model: "cline-pass/deepseek-v4-pro" });
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async () => {
				throw new Error("offline");
			}),
		);

		const result = await createClineProviderService().getProviderModels("cline-pass");

		expect(result.models).toEqual([{ id: "cline-pass/deepseek-v4-pro", name: "cline-pass/deepseek-v4-pro" }]);
	});

	it("does not reach for the catalog for providers the SDK already knows", async () => {
		setSelectedProviderSettings({ provider: "cline", model: "anthropic/claude-sonnet-4.6" });
		localProviderMocks.getLocalProviderModels.mockResolvedValue({
			providerId: "cline",
			models: [{ id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6" }],
		});
		const fetchMock = stubModelsCatalogFetch();

		const result = await createClineProviderService().getProviderModels("cline");

		expect(fetchMock).not.toHaveBeenCalled();
		expect(result.models.map((model) => model.id)).toEqual(["anthropic/claude-sonnet-4.6"]);
	});
});

describe("resolveLaunchConfig for ClinePass", () => {
	it("keeps the ClinePass provider id and prefixes the account token", async () => {
		setSelectedProviderSettings({
			provider: "cline-pass",
			model: "cline-pass/glm-5.2",
			auth: { accessToken: "workos:test-token", refreshToken: "refresh-token", expiresAt: Date.now() + 60_000 },
		});
		oauthMocks.getValidClineCredentials.mockResolvedValue({
			access: "refreshed-token",
			refresh: "refresh-token",
			expires: Date.now() + 3_600_000,
		});

		const result = await createClineProviderService().resolveLaunchConfig();

		expect(result).toMatchObject({
			providerId: "cline-pass",
			modelId: "cline-pass/glm-5.2",
			apiKey: "workos:refreshed-token",
		});
	});

	it("refreshes ClinePass credentials through the Cline identity provider", async () => {
		setSelectedProviderSettings({
			provider: "cline-pass",
			model: "cline-pass/glm-5.2",
			auth: { accessToken: "workos:test-token", refreshToken: "refresh-token", expiresAt: Date.now() + 60_000 },
		});
		oauthMocks.getValidClineCredentials.mockResolvedValue({
			access: "refreshed-token",
			refresh: "refresh-token",
			expires: Date.now() + 3_600_000,
		});

		await createClineProviderService().resolveLaunchConfig();

		expect(oauthMocks.getValidClineCredentials).toHaveBeenCalledWith(
			expect.objectContaining({ access: "test-token", refresh: "refresh-token" }),
			expect.objectContaining({ provider: "cline" }),
		);
	});

	it("uses CLINE_API_KEY when ClinePass has no saved credentials", async () => {
		setSelectedProviderSettings({ provider: "cline-pass", model: "cline-pass/glm-5.2" });
		vi.stubEnv("CLINE_API_KEY", "env-cline-key");

		const result = await createClineProviderService().resolveLaunchConfig();

		expect(result.apiKey).toBe("env-cline-key");
	});

	it("names ClinePass in the error when no credentials are configured at all", async () => {
		setSelectedProviderSettings({ provider: "cline-pass", model: "cline-pass/glm-5.2" });
		vi.stubEnv("CLINE_API_KEY", "");

		await expect(createClineProviderService().resolveLaunchConfig()).rejects.toThrow(/ClinePass/);
	});

	it("falls back to the ClinePass default model when none is saved", async () => {
		setSelectedProviderSettings({ provider: "cline-pass" });
		vi.stubEnv("CLINE_API_KEY", "env-cline-key");

		const result = await createClineProviderService().resolveLaunchConfig();

		expect(result.modelId).toBe("cline-pass/glm-5.2");
	});
});

describe("Cline account features with ClinePass selected", () => {
	it("reads the account balance, because ClinePass is a Cline account", async () => {
		setSelectedProviderSettings({
			provider: "cline-pass",
			auth: { accessToken: "test-token" },
		});
		clineAccountMocks.fetchMe.mockResolvedValue({
			id: "user-1",
			email: "test@example.com",
			displayName: "Test User",
			organizations: [],
		});
		clineAccountMocks.fetchBalance.mockResolvedValue({ balance: 5_000_000, userId: "user-1" });

		const result = await createClineProviderService().getClineAccountBalance();

		expect(result).toEqual({
			balance: 5_000_000,
			activeAccountLabel: "Personal",
			activeOrganizationId: null,
		});
	});

	it("reports the ClinePass account profile", async () => {
		setSelectedProviderSettings({
			provider: "cline-pass",
			auth: { accessToken: "test-token" },
		});
		clineAccountMocks.fetchMe.mockResolvedValue({
			id: "user-1",
			email: "test@example.com",
			displayName: "Test User",
		});

		const result = await createClineProviderService().getClineAccountProfile();

		expect(result.profile).toEqual({
			accountId: "user-1",
			email: "test@example.com",
			displayName: "Test User",
		});
	});

	it("still ignores providers that are not backed by a Cline account", async () => {
		setSelectedProviderSettings({ provider: "anthropic", apiKey: "sk-test" });

		const result = await createClineProviderService().getClineAccountBalance();

		expect(result).toEqual({ balance: null, activeAccountLabel: null, activeOrganizationId: null });
	});
});
