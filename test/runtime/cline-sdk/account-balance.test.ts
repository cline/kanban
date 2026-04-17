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

vi.mock("@clinebot/core/node", () => ({
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
