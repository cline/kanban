import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	ensureCustomProvidersLoaded: vi.fn(),
	listSdkProviderCatalog: vi.fn(),
	listSdkProviderModels: vi.fn(),
	getSdkProviderSettings: vi.fn(),
	getLastUsedSdkProviderSettings: vi.fn(),
	refreshManagedOauthCredentials: vi.fn(),
	resolveSdkLaunchProviderId: vi.fn((providerId: string) => providerId),
	saveSdkProviderSettings: vi.fn(),
}));

vi.mock("../../../src/cline-sdk/sdk-provider-boundary", () => ({
	ensureSdkCustomProvidersLoaded: mocks.ensureCustomProvidersLoaded,
	listSdkProviderCatalog: mocks.listSdkProviderCatalog,
	listSdkProviderModels: mocks.listSdkProviderModels,
	getSdkProviderSettings: mocks.getSdkProviderSettings,
	getLastUsedSdkProviderSettings: mocks.getLastUsedSdkProviderSettings,
	refreshManagedOauthCredentials: mocks.refreshManagedOauthCredentials,
	resolveSdkLaunchProviderId: mocks.resolveSdkLaunchProviderId,
	saveSdkProviderSettings: mocks.saveSdkProviderSettings,
	SDK_DEFAULT_MODEL_ID: "anthropic/claude-sonnet-4.6",
	SDK_DEFAULT_PROVIDER_ID: "cline",
}));

vi.mock("../../../src/server/browser", () => ({
	openInBrowser: vi.fn(),
}));

import { createClineProviderService } from "../../../src/cline-sdk/cline-provider-service";

describe("ensureSdkCustomProvidersLoaded call ordering", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.ensureCustomProvidersLoaded.mockResolvedValue(undefined);
		mocks.listSdkProviderCatalog.mockResolvedValue([]);
		mocks.listSdkProviderModels.mockResolvedValue([]);
		mocks.getSdkProviderSettings.mockReturnValue(undefined);
		mocks.getLastUsedSdkProviderSettings.mockReturnValue(undefined);
		mocks.refreshManagedOauthCredentials.mockResolvedValue(null);
		mocks.saveSdkProviderSettings.mockReturnValue(undefined);
	});

	it("starts loading persisted custom providers when the service is created", () => {
		createClineProviderService();

		expect(mocks.ensureCustomProvidersLoaded).toHaveBeenCalledTimes(1);
	});

	it("calls ensureSdkCustomProvidersLoaded before resolveLaunchConfig", async () => {
		mocks.getLastUsedSdkProviderSettings.mockReturnValue({
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			apiKey: "sk-test",
		});

		const service = createClineProviderService();
		await service.resolveLaunchConfig();

		expect(mocks.ensureCustomProvidersLoaded).toHaveBeenCalledTimes(1);
	});

	it("uses the SDK-compatible runtime provider ID for custom providers", async () => {
		mocks.getLastUsedSdkProviderSettings.mockReturnValue({
			provider: "ha",
			model: "custom-model",
			apiKey: "sk-test",
		});
		mocks.resolveSdkLaunchProviderId.mockReturnValue("lmstudio");

		const service = createClineProviderService();
		const config = await service.resolveLaunchConfig();

		expect(mocks.resolveSdkLaunchProviderId).toHaveBeenCalledWith("ha");
		expect(config.providerId).toBe("lmstudio");
	});

	it("calls ensureSdkCustomProvidersLoaded before getProviderCatalog", async () => {
		mocks.getLastUsedSdkProviderSettings.mockReturnValue({
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
		});

		const service = createClineProviderService();
		await service.getProviderCatalog();

		expect(mocks.ensureCustomProvidersLoaded).toHaveBeenCalledTimes(1);
	});

	it("calls ensureSdkCustomProvidersLoaded before getProviderModels", async () => {
		const service = createClineProviderService();
		await service.getProviderModels("cline");

		expect(mocks.ensureCustomProvidersLoaded).toHaveBeenCalledTimes(1);
		expect(mocks.listSdkProviderModels).toHaveBeenCalledWith("cline");
	});

	it("calls ensureSdkCustomProvidersLoaded before each registry-dependent method", async () => {
		mocks.getLastUsedSdkProviderSettings.mockReturnValue({
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			auth: {
				accessToken: "test-token",
				refreshToken: "test-refresh",
				expiresAt: Date.now() + 3600000,
			},
		});
		mocks.refreshManagedOauthCredentials.mockResolvedValue({
			access: "valid-token",
			refresh: "valid-refresh",
			expires: Date.now() + 3600000,
		});

		const service = createClineProviderService();
		await service.getProviderCatalog();
		await service.getProviderModels("cline");

		// Verify ensureSdkCustomProvidersLoaded is called before registry access
		expect(mocks.ensureCustomProvidersLoaded).toHaveBeenCalledTimes(2);
		expect(mocks.listSdkProviderCatalog).toHaveBeenCalled();
		expect(mocks.listSdkProviderModels).toHaveBeenCalledWith("cline");
		// Verify ordering: ensure called before catalog
		expect(mocks.ensureCustomProvidersLoaded.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.listSdkProviderCatalog.mock.invocationCallOrder[0],
		);
	});

	it("retries ensureSdkCustomProvidersLoaded on failure", async () => {
		mocks.ensureCustomProvidersLoaded
			.mockRejectedValueOnce(new Error("SDK not ready"))
			.mockResolvedValueOnce(undefined);
		mocks.listSdkProviderCatalog.mockResolvedValue([]);

		const service = createClineProviderService();

		await expect(service.getProviderCatalog()).rejects.toThrow("SDK not ready");
		await service.getProviderCatalog();

		expect(mocks.ensureCustomProvidersLoaded).toHaveBeenCalledTimes(2);
	});
});
