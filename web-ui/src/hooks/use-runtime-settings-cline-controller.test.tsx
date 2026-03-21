import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRuntimeSettingsClineController } from "@/hooks/use-runtime-settings-cline-controller";
import type { RuntimeConfigResponse } from "@/runtime/types";

const fetchClineProviderCatalogMock = vi.hoisted(() => vi.fn());
const fetchClineProviderModelsMock = vi.hoisted(() => vi.fn());
const saveClineProviderSettingsMock = vi.hoisted(() => vi.fn());
const runClineProviderOauthLoginMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/runtime-config-query", () => ({
	fetchClineProviderCatalog: fetchClineProviderCatalogMock,
	fetchClineProviderModels: fetchClineProviderModelsMock,
	saveClineProviderSettings: saveClineProviderSettingsMock,
	runClineProviderOauthLogin: runClineProviderOauthLoginMock,
}));

interface HookSnapshot {
	providerId: string;
	modelId: string;
	apiKey: string;
	baseUrl: string;
	providerCatalogIds: string[];
	providerModelIds: string[];
	isOauthProviderSelected: boolean;
	apiKeyConfigured: boolean;
	oauthConfigured: boolean;
	oauthAccountId: string;
	hasUnsavedChanges: boolean;
	setProviderId: (value: string) => void;
	setModelId: (value: string) => void;
	setApiKey: (value: string) => void;
	setBaseUrl: (value: string) => void;
	saveProviderSettings: () => Promise<{ ok: boolean; message?: string }>;
	runOauthLogin: () => Promise<{ ok: boolean; message?: string }>;
}

function createRuntimeConfigResponse(clineOverrides: Partial<RuntimeConfigResponse["clineProviderSettings"]> = {}): RuntimeConfigResponse {
	return {
		selectedAgentId: "cline",
		selectedShortcutLabel: null,
		agentAutonomousModeEnabled: true,
		effectiveCommand: "cline",
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project/.cline/kanban/config.json",
		readyForReviewNotificationsEnabled: true,
		detectedCommands: ["cline"],
		agents: [
			{
				id: "cline",
				label: "Cline",
				binary: "cline",
				command: "cline",
				defaultArgs: [],
				installed: true,
				configured: true,
			},
		],
		shortcuts: [],
		clineProviderSettings: {
			providerId: "cline",
			modelId: "claude-sonnet-4-6",
			baseUrl: null,
			apiKeyConfigured: false,
			oauthProvider: "cline",
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
			...clineOverrides,
		},
		commitPromptTemplate: "",
		openPrPromptTemplate: "",
		commitPromptTemplateDefault: "",
		openPrPromptTemplateDefault: "",
	};
}

function createLegacyRuntimeConfigResponse(): RuntimeConfigResponse {
	const { clineProviderSettings: _clineProviderSettings, ...legacyConfig } = createRuntimeConfigResponse();
	return legacyConfig as RuntimeConfigResponse;
}

function requireSnapshot(snapshot: HookSnapshot | null): HookSnapshot {
	if (!snapshot) {
		throw new Error("Expected hook snapshot.");
	}
	return snapshot;
}

async function flushAsyncWork(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

function HookHarness({
	open,
	workspaceId,
	selectedAgentId,
	config,
	onSnapshot,
}: {
	open: boolean;
	workspaceId: string | null;
	selectedAgentId: RuntimeConfigResponse["selectedAgentId"];
	config: RuntimeConfigResponse | null;
	onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
	const state = useRuntimeSettingsClineController({
		open,
		workspaceId,
		selectedAgentId,
		config,
	});

	useEffect(() => {
		onSnapshot({
			providerId: state.providerId,
			modelId: state.modelId,
			apiKey: state.apiKey,
			baseUrl: state.baseUrl,
			providerCatalogIds: state.providerCatalog.map((provider) => provider.id),
			providerModelIds: state.providerModels.map((model) => model.id),
			isOauthProviderSelected: state.isOauthProviderSelected,
			apiKeyConfigured: state.apiKeyConfigured,
			oauthConfigured: state.oauthConfigured,
			oauthAccountId: state.oauthAccountId,
			hasUnsavedChanges: state.hasUnsavedChanges,
			setProviderId: (value) => {
				state.setProviderId(value);
			},
			setModelId: (value) => {
				state.setModelId(value);
			},
			setApiKey: (value) => {
				state.setApiKey(value);
			},
			setBaseUrl: (value) => {
				state.setBaseUrl(value);
			},
			saveProviderSettings: state.saveProviderSettings,
			runOauthLogin: state.runOauthLogin,
		});
	}, [onSnapshot, state]);

	return null;
}

describe("useRuntimeSettingsClineController", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		fetchClineProviderCatalogMock.mockReset();
		fetchClineProviderModelsMock.mockReset();
		saveClineProviderSettingsMock.mockReset();
		runClineProviderOauthLoginMock.mockReset();
		fetchClineProviderCatalogMock.mockResolvedValue([]);
		fetchClineProviderModelsMock.mockResolvedValue([]);
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("loads provider catalog and models for the current Cline provider", async () => {
		const config = createRuntimeConfigResponse();
		let latestSnapshot: HookSnapshot | null = null;
		fetchClineProviderCatalogMock.mockResolvedValue([
			{
				id: "cline",
				name: "Cline",
				oauthSupported: true,
				enabled: true,
				defaultModelId: "claude-sonnet-4-6",
			},
		]);
		fetchClineProviderModelsMock.mockResolvedValue([
			{
				id: "claude-sonnet-4-6",
				name: "Claude Sonnet 4.6",
			},
		]);

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="cline"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			await flushAsyncWork();
		});

		expect(fetchClineProviderCatalogMock).toHaveBeenCalledWith("workspace-1");
		expect(fetchClineProviderModelsMock).toHaveBeenCalledWith("workspace-1", "cline");
		expect(requireSnapshot(latestSnapshot).providerCatalogIds).toEqual(["cline"]);
		expect(requireSnapshot(latestSnapshot).providerModelIds).toEqual(["claude-sonnet-4-6"]);
		expect(requireSnapshot(latestSnapshot).isOauthProviderSelected).toBe(true);
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});

	it("loads provider catalog and models without a selected workspace", async () => {
		const config = createRuntimeConfigResponse();
		let latestSnapshot: HookSnapshot | null = null;
		fetchClineProviderCatalogMock.mockResolvedValue([
			{
				id: "cline",
				name: "Cline",
				oauthSupported: true,
				enabled: true,
				defaultModelId: "claude-sonnet-4-6",
			},
		]);
		fetchClineProviderModelsMock.mockResolvedValue([
			{
				id: "claude-sonnet-4-6",
				name: "Claude Sonnet 4.6",
			},
		]);

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId={null}
					selectedAgentId="cline"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			await flushAsyncWork();
		});

		expect(fetchClineProviderCatalogMock).toHaveBeenCalledWith(null);
		expect(fetchClineProviderModelsMock).toHaveBeenCalledWith(null, "cline");
		expect(requireSnapshot(latestSnapshot).providerCatalogIds).toEqual(["cline"]);
		expect(requireSnapshot(latestSnapshot).providerModelIds).toEqual(["claude-sonnet-4-6"]);
	});

	it("falls back to empty provider settings when the config omits cline settings", async () => {
		const config = createLegacyRuntimeConfigResponse();
		let latestSnapshot: HookSnapshot | null = null;
		fetchClineProviderCatalogMock.mockResolvedValue([
			{
				id: "cline",
				name: "Cline",
				oauthSupported: true,
				enabled: true,
				defaultModelId: "claude-sonnet-4-6",
			},
		]);

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="cline"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			await flushAsyncWork();
		});

		expect(fetchClineProviderCatalogMock).toHaveBeenCalledWith("workspace-1");
		expect(fetchClineProviderModelsMock).not.toHaveBeenCalled();
		expect(requireSnapshot(latestSnapshot).providerId).toBe("");
		expect(requireSnapshot(latestSnapshot).modelId).toBe("");
		expect(requireSnapshot(latestSnapshot).baseUrl).toBe("");
		expect(requireSnapshot(latestSnapshot).isOauthProviderSelected).toBe(false);
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});

	it("saves the current provider draft and clears dirty state using the saved override", async () => {
		const config = createRuntimeConfigResponse({
			providerId: "anthropic",
			oauthProvider: null,
			modelId: "claude-sonnet-4-5",
			baseUrl: "https://old.example.com",
		});
		let latestSnapshot: HookSnapshot | null = null;
		saveClineProviderSettingsMock.mockResolvedValue({
			providerId: "openrouter",
			modelId: "gpt-5",
			baseUrl: "https://openrouter.ai/api",
			apiKeyConfigured: true,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="cline"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).setProviderId("openrouter");
			requireSnapshot(latestSnapshot).setModelId("gpt-5");
			requireSnapshot(latestSnapshot).setBaseUrl("https://openrouter.ai/api");
			requireSnapshot(latestSnapshot).setApiKey("secret-key");
			await flushAsyncWork();
		});

		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(true);

		await act(async () => {
			expect(await requireSnapshot(latestSnapshot).saveProviderSettings()).toEqual({ ok: true });
		});

		expect(saveClineProviderSettingsMock).toHaveBeenCalledWith("workspace-1", {
			providerId: "openrouter",
			modelId: "gpt-5",
			apiKey: "secret-key",
			baseUrl: "https://openrouter.ai/api",
		});
		expect(requireSnapshot(latestSnapshot).providerId).toBe("openrouter");
		expect(requireSnapshot(latestSnapshot).modelId).toBe("gpt-5");
		expect(requireSnapshot(latestSnapshot).baseUrl).toBe("https://openrouter.ai/api");
		expect(requireSnapshot(latestSnapshot).apiKey).toBe("");
		expect(requireSnapshot(latestSnapshot).apiKeyConfigured).toBe(true);
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});

	it("applies OAuth login results to the local settings state", async () => {
		const config = createRuntimeConfigResponse({
			providerId: "cline",
			oauthProvider: "cline",
			oauthAccessTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		});
		let latestSnapshot: HookSnapshot | null = null;
		runClineProviderOauthLoginMock.mockResolvedValue({
			ok: true,
			provider: "cline",
			settings: {
				providerId: "cline",
				modelId: "claude-sonnet-4-6",
				baseUrl: null,
				apiKeyConfigured: false,
				oauthProvider: "cline",
				oauthAccessTokenConfigured: true,
				oauthRefreshTokenConfigured: true,
				oauthAccountId: "acct-123",
				oauthExpiresAt: 123456789,
			},
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="cline"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			expect(await requireSnapshot(latestSnapshot).runOauthLogin()).toEqual({ ok: true });
		});

		expect(runClineProviderOauthLoginMock).toHaveBeenCalledWith("workspace-1", {
			provider: "cline",
			baseUrl: null,
		});
		expect(requireSnapshot(latestSnapshot).oauthConfigured).toBe(true);
		expect(requireSnapshot(latestSnapshot).oauthAccountId).toBe("acct-123");
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});
});
