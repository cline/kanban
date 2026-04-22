import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";

const agentRegistryMocks = vi.hoisted(() => ({
	resolveAgentCommand: vi.fn(),
	buildRuntimeConfigResponse: vi.fn(),
}));

const taskWorktreeMocks = vi.hoisted(() => ({
	resolveTaskCwd: vi.fn(),
}));

const turnCheckpointMocks = vi.hoisted(() => ({
	captureTaskTurnCheckpoint: vi.fn(),
}));

const oauthMocks = vi.hoisted(() => ({
	addLocalProvider: vi.fn(),
	ensureCustomProvidersLoaded: vi.fn(),
	getValidClineCredentials: vi.fn(),
	getValidOcaCredentials: vi.fn(),
	getValidOpenAICodexCredentials: vi.fn(),
	loginClineOAuth: vi.fn(),
	loginOcaOAuth: vi.fn(),
	loginOpenAICodex: vi.fn(),
	resolveDefaultMcpSettingsPath: vi.fn(),
	loadMcpSettingsFile: vi.fn(),
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

const clineAccountMocks = vi.hoisted(() => ({
	fetchMe: vi.fn(),
	fetchRemoteConfig: vi.fn(),
	fetchOrganization: vi.fn(),
	fetchFeaturebaseToken: vi.fn(),
	constructedOptions: [] as Array<{ apiBaseUrl: string; getAuthToken: () => Promise<string | undefined | null> }>,
}));

const browserMocks = vi.hoisted(() => ({
	openInBrowser: vi.fn(),
}));

vi.mock("../../../src/terminal/agent-registry.js", () => ({
	resolveAgentCommand: agentRegistryMocks.resolveAgentCommand,
	buildRuntimeConfigResponse: agentRegistryMocks.buildRuntimeConfigResponse,
}));

vi.mock("../../../src/workspace/task-worktree.js", () => ({
	resolveTaskCwd: taskWorktreeMocks.resolveTaskCwd,
}));

vi.mock("../../../src/workspace/turn-checkpoints.js", () => ({
	captureTaskTurnCheckpoint: turnCheckpointMocks.captureTaskTurnCheckpoint,
}));

vi.mock("@clinebot/core", () => ({
	addLocalProvider: oauthMocks.addLocalProvider,
	ensureCustomProvidersLoaded: oauthMocks.ensureCustomProvidersLoaded,
	getLocalProviderModels: localProviderMocks.getLocalProviderModels,
	getValidClineCredentials: oauthMocks.getValidClineCredentials,
	getValidOcaCredentials: oauthMocks.getValidOcaCredentials,
	getValidOpenAICodexCredentials: oauthMocks.getValidOpenAICodexCredentials,
	loginClineOAuth: oauthMocks.loginClineOAuth,
	loginOcaOAuth: oauthMocks.loginOcaOAuth,
	loginOpenAICodex: oauthMocks.loginOpenAICodex,
	resolveDefaultMcpSettingsPath: oauthMocks.resolveDefaultMcpSettingsPath,
	loadMcpSettingsFile: oauthMocks.loadMcpSettingsFile,
	ClineAccountService: class {
		constructor(options: { apiBaseUrl: string; getAuthToken: () => Promise<string | undefined | null> }) {
			clineAccountMocks.constructedOptions.push(options);
		}
		fetchMe = clineAccountMocks.fetchMe;
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
}));

vi.mock("../../../src/server/browser.js", () => ({
	openInBrowser: browserMocks.openInBrowser,
}));

import { createRuntimeApi } from "../../../src/trpc/runtime-api";

function createSummary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "running",
		agentId: "claude",
		workspacePath: "/tmp/worktree",
		pid: 1234,
		startedAt: Date.now(),
		updatedAt: Date.now(),
		lastOutputAt: Date.now(),
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
		...overrides,
	};
}

function createRuntimeConfigState(): RuntimeConfigState {
	return {
		selectedAgentId: "claude",
		selectedShortcutLabel: null,
		agentAutonomousModeEnabled: true,
		readyForReviewNotificationsEnabled: true,
		shortcuts: [],
		commitPromptTemplate: "commit",
		openPrPromptTemplate: "pr",
		commitPromptTemplateDefault: "commit",
		openPrPromptTemplateDefault: "pr",
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project-config.json",
	};
}

function setSelectedProviderSettings(
	settings: {
		provider: string;
		model?: string;
		baseUrl?: string;
		apiKey?: string;
		reasoning?: {
			effort?: "low" | "medium" | "high" | "xhigh";
		};
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

function restoreEnvVar(name: "CLINE_API_KEY" | "OCA_API_KEY", value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}

function createClineTaskSessionServiceMock() {
	return {
		startTaskSession: vi.fn<(...args: unknown[]) => Promise<RuntimeTaskSessionSummary>>(async () =>
			createSummary({ agentId: "cline", pid: null }),
		),
		onMessage: vi.fn<(...args: unknown[]) => () => void>(() => () => {}),
		stopTaskSession: vi.fn<(...args: unknown[]) => Promise<RuntimeTaskSessionSummary | null>>(async () => null),
		abortTaskSession: vi.fn<(...args: unknown[]) => Promise<RuntimeTaskSessionSummary | null>>(async () => null),
		cancelTaskTurn: vi.fn<(...args: unknown[]) => Promise<RuntimeTaskSessionSummary | null>>(async () => null),
		sendTaskSessionInput: vi.fn<(...args: unknown[]) => Promise<RuntimeTaskSessionSummary | null>>(async () => null),
		clearTaskSession: vi.fn<(...args: unknown[]) => Promise<RuntimeTaskSessionSummary | null>>(async () => null),
		reloadTaskSession: vi.fn<(...args: unknown[]) => Promise<RuntimeTaskSessionSummary | null>>(async () => null),
		rebindPersistedTaskSession: vi.fn<(...args: unknown[]) => Promise<RuntimeTaskSessionSummary | null>>(
			async () => null,
		),
		getSummary: vi.fn<(...args: unknown[]) => RuntimeTaskSessionSummary | null>(() => null),
		listSummaries: vi.fn<(...args: unknown[]) => RuntimeTaskSessionSummary[]>(() => []),
		listMessages: vi.fn<(...args: unknown[]) => unknown[]>(() => []),
		loadTaskSessionMessages: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
		applyTurnCheckpoint: vi.fn<(...args: unknown[]) => RuntimeTaskSessionSummary | null>(() => null),
		dispose: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
	};
}

describe("createRuntimeApi startTaskSession", () => {
	const originalClineApiKey = process.env.CLINE_API_KEY;
	const originalOcaApiKey = process.env.OCA_API_KEY;
	const originalClineMcpSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
	const originalClineMcpOauthSettingsPath = process.env.CLINE_MCP_OAUTH_SETTINGS_PATH;
	let mcpSettingsPath = "";
	let mcpOauthSettingsPath = "";

	beforeEach(() => {
		mcpSettingsPath = `/tmp/kanban-mcp-settings-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
		mcpOauthSettingsPath = `/tmp/kanban-mcp-oauth-settings-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
		process.env.CLINE_MCP_SETTINGS_PATH = mcpSettingsPath;
		process.env.CLINE_MCP_OAUTH_SETTINGS_PATH = mcpOauthSettingsPath;
		agentRegistryMocks.resolveAgentCommand.mockReset();
		agentRegistryMocks.buildRuntimeConfigResponse.mockReset();
		taskWorktreeMocks.resolveTaskCwd.mockReset();
		turnCheckpointMocks.captureTaskTurnCheckpoint.mockReset();
		oauthMocks.addLocalProvider.mockReset();
		oauthMocks.ensureCustomProvidersLoaded.mockReset();
		oauthMocks.loginClineOAuth.mockReset();
		oauthMocks.loginOcaOAuth.mockReset();
		oauthMocks.loginOpenAICodex.mockReset();
		oauthMocks.getValidClineCredentials.mockReset();
		oauthMocks.getValidOcaCredentials.mockReset();
		oauthMocks.getValidOpenAICodexCredentials.mockReset();
		oauthMocks.resolveDefaultMcpSettingsPath.mockReset();
		oauthMocks.loadMcpSettingsFile.mockReset();
		oauthMocks.saveProviderSettings.mockReset();
		oauthMocks.getProviderSettings.mockReset();
		oauthMocks.getLastUsedProviderSettings.mockReset();
		clineAccountMocks.fetchMe.mockReset();
		clineAccountMocks.fetchRemoteConfig.mockReset();
		clineAccountMocks.constructedOptions.length = 0;
		localProviderMocks.getLocalProviderModels.mockReset();
		llmsModelMocks.getAllProviders.mockReset();
		llmsModelMocks.getModelsForProvider.mockReset();
		browserMocks.openInBrowser.mockReset();

		agentRegistryMocks.resolveAgentCommand.mockReturnValue({
			agentId: "claude",
			label: "Claude Code",
			command: "claude",
			binary: "claude",
			args: [],
		});
		turnCheckpointMocks.captureTaskTurnCheckpoint.mockResolvedValue({
			turn: 1,
			ref: "refs/kanban/checkpoints/task-1/turn/1",
			commit: "1111111",
			createdAt: Date.now(),
		});
		oauthMocks.loginClineOAuth.mockResolvedValue({
			access: "oauth-access",
			refresh: "oauth-refresh",
			expires: 1_700_000_000_000,
			accountId: "acct-1",
		});
		oauthMocks.loginOcaOAuth.mockResolvedValue({
			access: "oca-access",
			refresh: "oca-refresh",
			expires: 1_700_000_000_000,
			accountId: "oca-acct",
		});
		oauthMocks.loginOpenAICodex.mockResolvedValue({
			access: "codex-access",
			refresh: "codex-refresh",
			expires: 1_700_000_000_000,
			accountId: "codex-acct",
		});
		oauthMocks.getValidClineCredentials.mockResolvedValue({
			access: "oauth-access",
			refresh: "oauth-refresh",
			expires: 1_700_000_000_000,
			accountId: "acct-1",
		});
		oauthMocks.getValidOcaCredentials.mockResolvedValue({
			access: "oca-access",
			refresh: "oca-refresh",
			expires: 1_700_000_000_000,
			accountId: "oca-acct",
		});
		oauthMocks.getValidOpenAICodexCredentials.mockResolvedValue({
			access: "codex-access",
			refresh: "codex-refresh",
			expires: 1_700_000_000_000,
			accountId: "codex-acct",
		});
		oauthMocks.addLocalProvider.mockResolvedValue({
			providerId: "custom-provider",
			settingsPath: "/tmp/providers.json",
			modelsPath: "/tmp/models.json",
			modelsCount: 1,
		});
		oauthMocks.ensureCustomProvidersLoaded.mockResolvedValue(undefined);
		llmsModelMocks.getAllProviders.mockResolvedValue([]);
		llmsModelMocks.getModelsForProvider.mockResolvedValue({});
		oauthMocks.resolveDefaultMcpSettingsPath.mockReturnValue(mcpSettingsPath);
		oauthMocks.loadMcpSettingsFile.mockReturnValue({
			mcpServers: {},
		});
		clineAccountMocks.fetchMe.mockResolvedValue({
			id: "acct-1",
			email: "saoud@example.com",
			displayName: "Saoud",
		});
		clineAccountMocks.fetchRemoteConfig.mockResolvedValue({
			organizationId: "org-1",
			enabled: true,
			value: JSON.stringify({
				kanbanEnabled: true,
			}),
		});
		setSelectedProviderSettings(null);
		llmsModelMocks.getAllProviders.mockResolvedValue([
			{
				id: "cline",
				name: "Cline",
				defaultModelId: "claude-sonnet-4-6",
				capabilities: ["oauth"],
			},
			{
				id: "anthropic",
				name: "Anthropic",
				defaultModelId: "claude-sonnet-4-6",
				capabilities: ["tools"],
			},
		]);
		llmsModelMocks.getModelsForProvider.mockImplementation(async (providerId: string) => {
			if (providerId !== "cline") {
				return {};
			}
			return {
				"claude-sonnet-4-6": {
					id: "claude-sonnet-4-6",
					name: "Claude Sonnet 4.6",
					capabilities: ["images", "files"],
				},
			};
		});
	});

	afterEach(() => {
		restoreEnvVar("CLINE_API_KEY", originalClineApiKey);
		restoreEnvVar("OCA_API_KEY", originalOcaApiKey);
		if (originalClineMcpSettingsPath === undefined) {
			delete process.env.CLINE_MCP_SETTINGS_PATH;
		} else {
			process.env.CLINE_MCP_SETTINGS_PATH = originalClineMcpSettingsPath;
		}
		if (originalClineMcpOauthSettingsPath === undefined) {
			delete process.env.CLINE_MCP_OAUTH_SETTINGS_PATH;
		} else {
			process.env.CLINE_MCP_OAUTH_SETTINGS_PATH = originalClineMcpOauthSettingsPath;
		}
		rmSync(mcpSettingsPath, { force: true });
		rmSync(`${mcpSettingsPath}.lock`, { force: true });
		rmSync(mcpOauthSettingsPath, { force: true });
		rmSync(`${mcpOauthSettingsPath}.lock`, { force: true });
	});

	it("reuses an existing worktree path before falling back to ensure", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Investigate startup freeze",
			},
		);

		expect(response.ok).toBe(true);
		expect(taskWorktreeMocks.resolveTaskCwd).toHaveBeenCalledTimes(1);
		expect(taskWorktreeMocks.resolveTaskCwd).toHaveBeenCalledWith({
			cwd: "/tmp/repo",
			taskId: "task-1",
			baseRef: "main",
			ensure: false,
		});
		expect(terminalManager.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: "/tmp/existing-worktree",
			}),
		);
	});

	it("ensures the worktree when no existing task cwd is available", async () => {
		taskWorktreeMocks.resolveTaskCwd
			.mockRejectedValueOnce(new Error("missing"))
			.mockResolvedValueOnce("/tmp/new-worktree");

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Investigate startup freeze",
			},
		);

		expect(response.ok).toBe(true);
		expect(taskWorktreeMocks.resolveTaskCwd).toHaveBeenNthCalledWith(1, {
			cwd: "/tmp/repo",
			taskId: "task-1",
			baseRef: "main",
			ensure: false,
		});
		expect(taskWorktreeMocks.resolveTaskCwd).toHaveBeenNthCalledWith(2, {
			cwd: "/tmp/repo",
			taskId: "task-1",
			baseRef: "main",
			ensure: true,
		});
	});

	it("routes cline start sessions to cline task session service", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "anthropic-api-key",
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Continue task",
				images: [
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
				startInPlanMode: true,
			},
		);

		expect(response.ok).toBe(true);
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				cwd: "/tmp/existing-worktree",
				prompt: "Continue task",
				images: [
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
				providerId: "anthropic",
				apiKey: "anthropic-api-key",
				mode: "act",
				startInPlanMode: true,
				resumeFromTrash: undefined,
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("applies task-level reasoning overrides even without task model/provider overrides", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "anthropic-api-key",
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Reasoning-only override task",
				clineSettings: {
					reasoningEffort: "medium",
				},
			},
		);

		expect(response.ok).toBe(true);
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				reasoningEffort: "medium",
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("uses model-default reasoning when a task overrides the model but leaves reasoning on default", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "anthropic-api-key",
			reasoning: {
				effort: "high",
			},
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Task with model override",
				clineSettings: {
					modelId: "anthropic/claude-opus-4.6",
				},
			},
		);

		expect(response.ok).toBe(true);
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "anthropic",
				modelId: "anthropic/claude-opus-4.6",
				reasoningEffort: null,
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("skips cline persisted-session probing when resumeFromTrash already has a non-cline terminal summary", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue({
			agentId: "codex",
			label: "OpenAI Codex",
			command: "codex",
			binary: "codex",
			args: [],
		});

		const terminalManager = {
			getSummary: vi.fn(() => createSummary({ agentId: "codex", state: "idle", pid: null })),
			startTaskSession: vi.fn(async () => createSummary({ agentId: "codex" })),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		const getScopedClineTaskSessionService = vi.fn(async () => clineTaskSessionService as never);

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService,
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Resume task",
				resumeFromTrash: true,
			},
		);

		expect(response.ok).toBe(true);
		expect(terminalManager.getSummary).toHaveBeenCalledWith("task-1");
		expect(getScopedClineTaskSessionService).not.toHaveBeenCalled();
		expect(clineTaskSessionService.rebindPersistedTaskSession).not.toHaveBeenCalled();
		expect(terminalManager.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				agentId: "codex",
				resumeFromTrash: true,
			}),
		);
		expect(turnCheckpointMocks.captureTaskTurnCheckpoint).not.toHaveBeenCalled();
	});

	it("clears task chat cache before resumeFromTrash starts", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue({
			agentId: "codex",
			label: "OpenAI Codex",
			command: "codex",
			binary: "codex",
			args: [],
		});

		const broadcastTaskChatCleared = vi.fn();
		const terminalManager = {
			getSummary: vi.fn(() => createSummary({ agentId: "codex", state: "idle", pid: null })),
			startTaskSession: vi.fn(async () => createSummary({ agentId: "codex" })),
			applyTurnCheckpoint: vi.fn(),
		};

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "codex";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			broadcastTaskChatCleared,
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Resume task",
				resumeFromTrash: true,
			},
		);

		expect(response.ok).toBe(true);
		expect(broadcastTaskChatCleared).toHaveBeenCalledWith("workspace-1", "task-1");
	});

	it("probes cline persisted sessions on resumeFromTrash when no terminal agent summary exists", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue({
			agentId: "codex",
			label: "OpenAI Codex",
			command: "codex",
			binary: "codex",
			args: [],
		});
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "anthropic-api-key",
		});

		const terminalManager = {
			getSummary: vi.fn(() => null),
			startTaskSession: vi.fn(async () => createSummary({ agentId: "codex" })),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.rebindPersistedTaskSession.mockResolvedValue(
			createSummary({ agentId: "cline", pid: null }),
		);
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "codex";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Resume task",
				resumeFromTrash: true,
			},
		);

		expect(response.ok).toBe(true);
		expect(terminalManager.getSummary).toHaveBeenCalledWith("task-1");
		expect(clineTaskSessionService.rebindPersistedTaskSession).toHaveBeenCalledWith("task-1");
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				resumeFromTrash: true,
				providerId: "anthropic",
				apiKey: "anthropic-api-key",
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
		expect(turnCheckpointMocks.captureTaskTurnCheckpoint).not.toHaveBeenCalled();
	});

	it("uses saved cline settings even when no last-used provider is recorded", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		oauthMocks.getLastUsedProviderSettings.mockReturnValue(undefined);
		oauthMocks.getProviderSettings.mockImplementation((providerId: string) =>
			providerId === "cline"
				? {
						provider: "cline",
						model: "anthropic/claude-opus-4.6",
						apiKey: "saved-cline-api-key",
					}
				: undefined,
		);

		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(
				async () => ({ startTaskSession: vi.fn(), applyTurnCheckpoint: vi.fn() }) as never,
			),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Continue task",
			},
		);

		expect(response.ok).toBe(true);
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "cline",
				modelId: "anthropic/claude-opus-4.6",
				apiKey: "saved-cline-api-key",
			}),
		);
	});

	it("fails early when the cline provider is selected without cline credentials", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		delete process.env.CLINE_API_KEY;
		setSelectedProviderSettings({
			provider: "cline",
			model: "anthropic/claude-opus-4.6",
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Continue task",
			},
		);

		expect(response.ok).toBe(false);
		expect(response.summary).toBeNull();
		expect(response.error).toContain("no Cline credentials are configured");
		expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("allows the cline provider to launch when CLINE_API_KEY is present in the environment", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		process.env.CLINE_API_KEY = "env-cline-api-key";
		setSelectedProviderSettings({
			provider: "cline",
			model: "anthropic/claude-opus-4.6",
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Continue task",
			},
		);

		expect(response.ok).toBe(true);
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "cline",
				apiKey: "env-cline-api-key",
			}),
		);
	});

	it("starts home agent sessions in the workspace root without resolving a task worktree", async () => {
		const homeTaskId = "__home_agent__:workspace-1:codex";
		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary({ taskId: homeTaskId })),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: homeTaskId,
				baseRef: "main",
				prompt: "",
			},
		);

		expect(response.ok).toBe(true);
		expect(taskWorktreeMocks.resolveTaskCwd).not.toHaveBeenCalled();
		expect(terminalManager.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: homeTaskId,
				cwd: "/tmp/repo",
			}),
		);
		expect(turnCheckpointMocks.captureTaskTurnCheckpoint).not.toHaveBeenCalled();
	});

	it("forwards task images to CLI task sessions", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue({
			agentId: "codex",
			label: "OpenAI Codex",
			command: "codex",
			binary: "codex",
			args: [],
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary({ agentId: "codex" })),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "codex";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const images = [
			{
				id: "img-1",
				data: Buffer.from("hello").toString("base64"),
				mimeType: "image/png",
				name: "diagram.png",
			},
		];

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Continue task",
				images,
			},
		);

		expect(response.ok).toBe(true);
		expect(terminalManager.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: "codex",
				images,
			}),
		);
		expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("does not resolve cline OAuth when starting a non-cline task session", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue({
			agentId: "codex",
			label: "OpenAI Codex",
			command: "codex",
			binary: "codex",
			args: [],
		});
		oauthMocks.getValidClineCredentials.mockRejectedValue(
			new Error('OAuth credentials for provider "cline" are invalid. Re-run OAuth login.'),
		);

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary({ agentId: "codex" })),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		setSelectedProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "workos:oauth-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "codex";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Continue task",
			},
		);

		expect(response.ok).toBe(true);
		expect(oauthMocks.getValidClineCredentials).not.toHaveBeenCalled();
		expect(terminalManager.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: "codex",
				cwd: "/tmp/existing-worktree",
			}),
		);
		expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("prefers OAuth api key when cline OAuth credentials are configured", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));
		oauthMocks.getValidClineCredentials.mockResolvedValue({
			access: "oauth-access",
			refresh: "oauth-refresh",
			expires: 1_700_000_000_000,
			accountId: "acct-1",
		});
		setSelectedProviderSettings({
			provider: "cline",
			model: "claude-sonnet-4-6",
			auth: {
				accessToken: "oauth-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Continue task",
			},
		);

		expect(response.ok).toBe(true);
		expect(oauthMocks.getValidClineCredentials).toHaveBeenCalledTimes(1);
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "workos:oauth-access",
			}),
		);
		expect(clineAccountMocks.fetchMe).not.toHaveBeenCalled();
		expect(oauthMocks.saveProviderSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "cline",
				auth: expect.objectContaining({
					accessToken: "workos:oauth-access",
					refreshToken: "oauth-refresh",
					accountId: "acct-1",
				}),
			}),
			expect.objectContaining({
				tokenSource: "oauth",
				setLastUsed: true,
			}),
		);
	});

	it("does not use OAuth credentials for non-OAuth providers", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));
		setSelectedProviderSettings({
			provider: "anthropic",
			apiKey: "anthropic-api-key",
			auth: {
				accessToken: "workos:oauth-access",
				refreshToken: "oauth-refresh",
				expiresAt: 1_700_000_000_000,
			},
		});

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Continue task",
			},
		);

		expect(response.ok).toBe(true);
		expect(oauthMocks.getValidClineCredentials).not.toHaveBeenCalled();
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "anthropic",
				apiKey: "anthropic-api-key",
			}),
		);
		expect(oauthMocks.saveProviderSettings).not.toHaveBeenCalled();
	});

	it("routes cline task input and stop to cline task session service", async () => {
		const summary = createSummary({ agentId: "cline", pid: null });
		const terminalManager = {
			writeInput: vi.fn(),
			stopTaskSession: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.sendTaskSessionInput.mockResolvedValue(summary);
		clineTaskSessionService.stopTaskSession.mockResolvedValue(summary);

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const sendResponse = await api.sendTaskSessionInput(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1", text: "hello", appendNewline: true },
		);
		expect(sendResponse.ok).toBe(true);
		expect(clineTaskSessionService.sendTaskSessionInput).toHaveBeenCalledWith("task-1", "hello\n");
		expect(terminalManager.writeInput).not.toHaveBeenCalled();

		const stopResponse = await api.stopTaskSession(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1" },
		);
		expect(stopResponse.ok).toBe(true);
		expect(clineTaskSessionService.stopTaskSession).toHaveBeenCalledWith("task-1");
		expect(terminalManager.stopTaskSession).not.toHaveBeenCalled();
	});

	it("returns cline chat messages and sends chat message through cline service", async () => {
		const summary = createSummary({ agentId: "cline", pid: null });
		const latestMessage = {
			id: "message-1",
			role: "user" as const,
			content: "hello",
			createdAt: Date.now(),
		};
		const terminalManager = {
			writeInput: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.sendTaskSessionInput.mockResolvedValue(summary);
		clineTaskSessionService.listMessages.mockReturnValue([latestMessage]);
		clineTaskSessionService.loadTaskSessionMessages.mockResolvedValue([latestMessage]);
		clineTaskSessionService.getSummary.mockReturnValue(summary);

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const sendResponse = await api.sendTaskChatMessage(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1", text: "hello" },
		);
		expect(sendResponse.ok).toBe(true);
		expect(clineTaskSessionService.sendTaskSessionInput).toHaveBeenCalledWith(
			"task-1",
			"hello",
			undefined,
			undefined,
		);
		expect(sendResponse.message).toEqual(latestMessage);

		const messagesResponse = await api.getTaskChatMessages(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1" },
		);
		expect(messagesResponse.ok).toBe(true);
		expect(messagesResponse.messages).toEqual([latestMessage]);

		clineTaskSessionService.abortTaskSession.mockResolvedValue(summary);
		const abortResponse = await api.abortTaskChatTurn(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1" },
		);
		expect(abortResponse.ok).toBe(true);
		expect(clineTaskSessionService.abortTaskSession).toHaveBeenCalledWith("task-1");

		clineTaskSessionService.cancelTaskTurn.mockResolvedValue(summary);
		const cancelResponse = await api.cancelTaskChatTurn(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1" },
		);
		expect(cancelResponse.ok).toBe(true);
		expect(clineTaskSessionService.cancelTaskTurn).toHaveBeenCalledWith("task-1");
	});

	it("handles clear slash commands without sending them to the model", async () => {
		const summary = createSummary({ agentId: "cline", pid: null, state: "idle" });
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.clearTaskSession.mockResolvedValue(summary);
		const broadcastTaskChatCleared = vi.fn();

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			broadcastTaskChatCleared,
		});

		const response = await api.sendTaskChatMessage(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "__home_agent__:workspace-1", text: "  /clear  " },
		);

		expect(response).toEqual({
			ok: true,
			summary,
			message: null,
		});
		expect(clineTaskSessionService.clearTaskSession).toHaveBeenCalledWith("__home_agent__:workspace-1");
		expect(broadcastTaskChatCleared).toHaveBeenCalledWith("workspace-1", "__home_agent__:workspace-1");
		expect(clineTaskSessionService.sendTaskSessionInput).not.toHaveBeenCalled();
		expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("forwards chat images through the cline service send path", async () => {
		const summary = createSummary({ agentId: "cline", pid: null });
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.sendTaskSessionInput.mockResolvedValue(summary);
		clineTaskSessionService.listMessages.mockReturnValue([]);

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.sendTaskChatMessage(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{
				taskId: "task-1",
				text: "hello",
				images: [
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
			},
		);

		expect(response.ok).toBe(true);
		expect(clineTaskSessionService.sendTaskSessionInput).toHaveBeenCalledWith("task-1", "hello", undefined, [
			{
				id: "img-1",
				data: "abc123",
				mimeType: "image/png",
			},
		]);
	});

	it("hydrates persisted cline chat messages when no live in-memory session is loaded", async () => {
		const persistedMessage = {
			id: "message-persisted-1",
			role: "assistant" as const,
			content: "Recovered from SDK artifacts",
			createdAt: Date.now(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.getSummary.mockReturnValue(null);
		clineTaskSessionService.loadTaskSessionMessages.mockResolvedValue([persistedMessage]);

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.getTaskChatMessages(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1" },
		);

		expect(response.ok).toBe(true);
		expect(response.messages).toEqual([persistedMessage]);
		expect(clineTaskSessionService.loadTaskSessionMessages).toHaveBeenCalledWith("task-1");
	});

	it("reloads a chat session through the Cline task session service", async () => {
		const summary = createSummary({ agentId: "cline", pid: null });
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.reloadTaskSession.mockResolvedValue(summary);

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.reloadTaskChatSession(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "__home_agent__:workspace-1:cline" },
		);

		expect(response).toEqual({
			ok: true,
			summary,
		});
		expect(clineTaskSessionService.reloadTaskSession).toHaveBeenCalledWith("__home_agent__:workspace-1:cline");
	});

	it("restarts the home chat session from the saved launch config when reload cannot reuse cached config", async () => {
		const summary = createSummary({ agentId: "cline", pid: null });
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.reloadTaskSession.mockResolvedValue(null);
		clineTaskSessionService.startTaskSession.mockResolvedValue(summary);
		setSelectedProviderSettings({
			provider: "openrouter",
			model: "openrouter/auto",
			apiKey: "sk-or-test",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoning: {},
		});

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.reloadTaskChatSession(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "__home_agent__:workspace-1:cline" },
		);

		expect(response).toEqual({
			ok: true,
			summary,
		});
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith({
			taskId: "__home_agent__:workspace-1:cline",
			cwd: "/tmp/repo",
			prompt: "",
			resumeFromPersistence: true,
			providerId: "openrouter",
			modelId: "openrouter/auto",
			apiKey: "sk-or-test",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoningEffort: undefined,
		});
	});

	it("rebinds persisted non-home chat sessions before retrying the first send after restart", async () => {
		const summary = createSummary({ agentId: "cline", pid: null });
		const latestMessage = {
			id: "message-rebound-1",
			role: "user" as const,
			content: "continue",
			createdAt: Date.now(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.sendTaskSessionInput.mockResolvedValueOnce(null).mockResolvedValueOnce(summary);
		clineTaskSessionService.rebindPersistedTaskSession.mockResolvedValue(summary);
		clineTaskSessionService.listMessages.mockReturnValue([latestMessage]);

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.sendTaskChatMessage(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1", text: "continue" },
		);

		expect(response.ok).toBe(true);
		expect(clineTaskSessionService.rebindPersistedTaskSession).toHaveBeenCalledWith("task-1");
		expect(clineTaskSessionService.sendTaskSessionInput).toHaveBeenNthCalledWith(
			1,
			"task-1",
			"continue",
			undefined,
			undefined,
		);
		expect(clineTaskSessionService.sendTaskSessionInput).toHaveBeenNthCalledWith(
			2,
			"task-1",
			"continue",
			undefined,
			undefined,
		);
		expect(response.message).toEqual(latestMessage);
	});

	it("auto-starts home chat sessions when the first message is sent", async () => {
		const summary = createSummary({ agentId: "cline", pid: null });
		const latestMessage = {
			id: "message-home-1",
			role: "user" as const,
			content: "hello home",
			createdAt: Date.now(),
		};
		const terminalManager = {
			writeInput: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		const runtimeConfigState = createRuntimeConfigState();
		setSelectedProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "seed-token",
				refreshToken: "seed-refresh",
				expiresAt: Date.now() + 3_600_000,
			},
		});
		clineTaskSessionService.sendTaskSessionInput.mockResolvedValue(null);
		clineTaskSessionService.startTaskSession.mockResolvedValue(summary);
		clineTaskSessionService.listMessages.mockReturnValue([latestMessage]);

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => runtimeConfigState),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.sendTaskChatMessage(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "__home_agent__:workspace-1", text: "hello home" },
		);

		expect(response.ok).toBe(true);
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "__home_agent__:workspace-1",
				cwd: "/tmp/repo",
				prompt: "hello home",
				providerId: "cline",
				apiKey: "workos:oauth-access",
			}),
		);
		expect(oauthMocks.getValidClineCredentials).toHaveBeenCalledWith(
			expect.objectContaining({
				access: "seed-token",
				refresh: "seed-refresh",
			}),
			expect.any(Object),
		);
		expect(response.message).toEqual(latestMessage);
	});

	it("starts home chat sessions from persisted history with current launch config", async () => {
		const summary = createSummary({ agentId: "cline", pid: null });
		const latestMessage = {
			id: "message-home-rebound-1",
			role: "user" as const,
			content: "continue home",
			createdAt: Date.now(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.sendTaskSessionInput.mockResolvedValueOnce(null);
		clineTaskSessionService.startTaskSession.mockResolvedValue(summary);
		clineTaskSessionService.listMessages.mockReturnValue([latestMessage]);
		setSelectedProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "seed-token",
				refreshToken: "seed-refresh",
				expiresAt: Date.now() + 3_600_000,
			},
		});

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.sendTaskChatMessage(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "__home_agent__:workspace-1", text: "continue home" },
		);

		expect(response.ok).toBe(true);
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "__home_agent__:workspace-1",
				cwd: "/tmp/repo",
				prompt: "continue home",
				resumeFromPersistence: true,
				providerId: "cline",
				apiKey: "workos:oauth-access",
			}),
		);
		expect(clineTaskSessionService.sendTaskSessionInput).toHaveBeenCalledTimes(1);
		expect(response.message).toEqual(latestMessage);
	});

	it("home chat auto-start keeps manual API key for non-OAuth providers", async () => {
		const summary = createSummary({ agentId: "cline", pid: null });
		const terminalManager = {
			writeInput: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		const runtimeConfigState = createRuntimeConfigState();
		setSelectedProviderSettings({
			provider: "anthropic",
			apiKey: "anthropic-api-key",
			auth: {
				accessToken: "workos:seed-token",
				refreshToken: "seed-refresh",
				expiresAt: Date.now() + 3_600_000,
			},
		});
		clineTaskSessionService.sendTaskSessionInput.mockResolvedValue(null);
		clineTaskSessionService.startTaskSession.mockResolvedValue(summary);

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => runtimeConfigState),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.sendTaskChatMessage(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "__home_agent__:workspace-1", text: "hello home" },
		);

		expect(response.ok).toBe(true);
		expect(oauthMocks.getValidClineCredentials).not.toHaveBeenCalled();
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "anthropic",
				apiKey: "anthropic-api-key",
			}),
		);
	});

	it("returns cline provider catalog and provider models", async () => {
		const terminalManager = {
			writeInput: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				return createRuntimeConfigState();
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "cline",
			model: "claude-sonnet-4-6",
		});

		const catalogResponse = await api.getClineProviderCatalog({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});
		expect(catalogResponse.providers.some((provider) => provider.id === "cline")).toBe(true);
		expect(catalogResponse.providers.find((provider) => provider.id === "cline")?.enabled).toBe(true);

		const modelsResponse = await api.getClineProviderModels(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ providerId: "cline" },
		);
		expect(modelsResponse.providerId).toBe("cline");
		expect(modelsResponse.models.some((model) => model.id === "claude-sonnet-4-6")).toBe(true);
	});

	it("loads provider models through the SDK local-provider resolver with saved config", async () => {
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "openrouter",
			model: "openrouter/auto",
			apiKey: "openrouter-key",
			baseUrl: "https://openrouter.ai/api/v1",
		});
		localProviderMocks.getLocalProviderModels.mockResolvedValue({
			providerId: "openrouter",
			models: [
				{
					id: "openrouter/free",
					name: "OpenRouter Free",
					supportsReasoning: true,
				},
			],
		});

		const response = await api.getClineProviderModels(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ providerId: "openrouter" },
		);

		expect(localProviderMocks.getLocalProviderModels).toHaveBeenCalledWith(
			"openrouter",
			expect.objectContaining({
				providerId: "openrouter",
				modelId: "openrouter/auto",
				apiKey: "openrouter-key",
				baseUrl: "https://openrouter.ai/api/v1",
			}),
		);
		expect(response).toEqual({
			providerId: "openrouter",
			models: [
				{
					id: "openrouter/free",
					name: "OpenRouter Free",
					supportsReasoningEffort: true,
				},
			],
		});
	});

	it("falls back to the queried provider's saved model when provider model loading fails", async () => {
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		oauthMocks.getLastUsedProviderSettings.mockReturnValue({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "anthropic-key",
		});
		oauthMocks.getProviderSettings.mockImplementation((providerId: string) => {
			if (providerId === "anthropic") {
				return {
					provider: "anthropic",
					model: "claude-sonnet-4-6",
					apiKey: "anthropic-key",
				};
			}
			if (providerId === "openrouter") {
				return {
					provider: "openrouter",
					model: "openrouter/free",
					apiKey: "openrouter-key",
					baseUrl: "https://openrouter.ai/api/v1",
				};
			}
			return undefined;
		});
		localProviderMocks.getLocalProviderModels.mockRejectedValue(new Error("catalog unavailable"));

		const response = await api.getClineProviderModels(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ providerId: "openrouter" },
		);

		expect(response).toEqual({
			providerId: "openrouter",
			models: [
				{
					id: "openrouter/free",
					name: "openrouter/free",
				},
			],
		});
	});

	it("adds a custom OpenAI-compatible provider through the SDK-backed flow", async () => {
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		llmsModelMocks.getAllProviders.mockResolvedValue([
			{
				id: "cline",
				name: "Cline",
				defaultModelId: "claude-sonnet-4-6",
				capabilities: ["oauth"],
			},
		]);
		oauthMocks.addLocalProvider.mockImplementation(async (_manager: unknown, request: Record<string, unknown>) => {
			oauthMocks.getProviderSettings.mockImplementation((providerId: string) =>
				providerId === request.providerId
					? {
							provider: request.providerId,
							model: request.defaultModelId,
							apiKey: request.apiKey,
							baseUrl: request.baseUrl,
						}
					: undefined,
			);
			return {
				providerId: request.providerId,
				settingsPath: "/tmp/providers.json",
				modelsPath: "/tmp/models.json",
				modelsCount: 1,
			};
		});

		const response = await api.addClineProvider(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{
				providerId: "my-provider",
				name: "My Provider",
				baseUrl: "http://localhost:8000/v1",
				apiKey: "secret-key",
				models: ["qwen2.5-coder:32b"],
				defaultModelId: "qwen2.5-coder:32b",
				capabilities: ["tools", "streaming"],
			},
		);

		expect(response).toEqual(
			expect.objectContaining({
				providerId: "my-provider",
				modelId: "qwen2.5-coder:32b",
				baseUrl: "http://localhost:8000/v1",
				apiKeyConfigured: true,
			}),
		);
		expect(oauthMocks.addLocalProvider).toHaveBeenCalledWith(
			expect.any(Object),
			expect.objectContaining({
				providerId: "my-provider",
				name: "My Provider",
				baseUrl: "http://localhost:8000/v1",
				apiKey: "secret-key",
				models: ["qwen2.5-coder:32b"],
				defaultModelId: "qwen2.5-coder:32b",
				capabilities: ["tools", "streaming"],
			}),
		);
		expect(oauthMocks.ensureCustomProvidersLoaded).toHaveBeenCalled();
		expect(oauthMocks.saveProviderSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "my-provider",
				model: "qwen2.5-coder:32b",
				apiKey: "secret-key",
				baseUrl: "http://localhost:8000/v1",
			}),
			expect.objectContaining({
				tokenSource: "manual",
				setLastUsed: true,
			}),
		);
	});

	it("returns cline account profile for cline OAuth users", async () => {
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "workos:oauth-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});

		const response = await api.getClineAccountProfile({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.profile).toEqual({
			accountId: "acct-1",
			email: "saoud@example.com",
			displayName: "Saoud",
		});
		expect(clineAccountMocks.constructedOptions[0]?.apiBaseUrl).toBe("https://api.cline.bot");
		expect(clineAccountMocks.fetchMe).toHaveBeenCalledTimes(1);
		expect(oauthMocks.getValidClineCredentials).not.toHaveBeenCalled();
		const getAuthToken = clineAccountMocks.constructedOptions[0]?.getAuthToken;
		await expect(getAuthToken?.()).resolves.toBe("workos:oauth-access");
	});

	it("refreshes cline OAuth credentials and retries profile lookup when direct profile fetch fails", async () => {
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		clineAccountMocks.fetchMe
			.mockRejectedValueOnce(new Error("Cline account request failed with status 401"))
			.mockResolvedValueOnce({
				id: "acct-1",
				email: "saoud@example.com",
				displayName: "Saoud",
			});
		setSelectedProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "workos:expired-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});

		const response = await api.getClineAccountProfile({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.profile).toEqual({
			accountId: "acct-1",
			email: "saoud@example.com",
			displayName: "Saoud",
		});
		expect(clineAccountMocks.fetchMe).toHaveBeenCalledTimes(2);
		expect(oauthMocks.getValidClineCredentials).toHaveBeenCalledTimes(1);
		const refreshedGetAuthToken = clineAccountMocks.constructedOptions[1]?.getAuthToken;
		await expect(refreshedGetAuthToken?.()).resolves.toBe("workos:oauth-access");
	});

	it("blocks kanban when remote config explicitly disables it", async () => {
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "workos:oauth-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});
		clineAccountMocks.fetchRemoteConfig.mockResolvedValueOnce({
			organizationId: "org-1",
			enabled: true,
			value: JSON.stringify({
				kanbanEnabled: false,
			}),
		});

		clineAccountMocks.fetchOrganization.mockResolvedValueOnce({
			externalOrganizationId: "test",
		});

		const response = await api.getClineKanbanAccess({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.enabled).toBe(false);
		expect(clineAccountMocks.fetchRemoteConfig).toHaveBeenCalledTimes(1);
	});

	it("allows kanban when remote config fetch fails", async () => {
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "workos:oauth-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});
		clineAccountMocks.fetchRemoteConfig
			.mockResolvedValueOnce({
				organizationId: "org-1",
				enabled: true,
				value: JSON.stringify({
					kanbanEnabled: false,
				}),
			})
			.mockRejectedValueOnce(new Error("remote config request failed"));

		clineAccountMocks.fetchOrganization.mockResolvedValueOnce({
			externalOrganizationId: "test",
		});

		const initialResponse = await api.getClineKanbanAccess({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});
		const failedFetchResponse = await api.getClineKanbanAccess({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(initialResponse.enabled).toBe(false);
		expect(failedFetchResponse.enabled).toBe(true);
		expect(clineAccountMocks.fetchRemoteConfig).toHaveBeenCalledTimes(2);
	});

	it("allows kanban by default for non-cline providers", async () => {
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "anthropic",
			apiKey: "anthropic-api-key",
		});

		const response = await api.getClineKanbanAccess({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.enabled).toBe(true);
		expect(clineAccountMocks.fetchRemoteConfig).not.toHaveBeenCalled();
	});

	it("runs oauth login for selected provider and persists provider settings", async () => {
		const terminalManager = {
			writeInput: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		const bumpClineSessionContextVersion = vi.fn();

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			bumpClineSessionContextVersion,
		});

		const response = await api.runClineProviderOAuthLogin(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ provider: "cline" },
		);
		expect(response.ok).toBe(true);
		expect(response.provider).toBe("cline");
		expect(response.settings).toEqual(
			expect.objectContaining({
				providerId: "cline",
				oauthProvider: "cline",
				oauthAccessTokenConfigured: true,
				oauthRefreshTokenConfigured: true,
				oauthAccountId: "acct-1",
			}),
		);
		expect(oauthMocks.saveProviderSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "cline",
				auth: expect.objectContaining({
					accessToken: "workos:oauth-access",
					refreshToken: "oauth-refresh",
					accountId: "acct-1",
				}),
			}),
			expect.objectContaining({
				tokenSource: "oauth",
				setLastUsed: true,
			}),
		);
		expect(oauthMocks.loginClineOAuth).toHaveBeenCalledTimes(1);
		expect(bumpClineSessionContextVersion).toHaveBeenCalledTimes(1);
		const loginInput = oauthMocks.loginClineOAuth.mock.calls[0]?.[0] as
			| {
					callbacks?: { onManualCodeInput?: unknown };
			  }
			| undefined;
		expect(loginInput?.callbacks?.onManualCodeInput).toBeUndefined();
	});

	it("bumps cline session context when provider settings are saved", async () => {
		const bumpClineSessionContextVersion = vi.fn();
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			bumpClineSessionContextVersion,
		});
		setSelectedProviderSettings({
			provider: "openrouter",
			model: "openrouter/auto",
			apiKey: "openrouter-key",
			baseUrl: "https://openrouter.ai/api/v1",
		});

		const response = await api.saveClineProviderSettings(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{
				providerId: "openrouter",
				modelId: "openrouter/free",
			},
		);

		expect(response.providerId).toBe("openrouter");
		expect(bumpClineSessionContextVersion).toHaveBeenCalledTimes(1);
	});

	it("returns Cline MCP settings", async () => {
		writeFileSync(
			mcpSettingsPath,
			JSON.stringify(
				{
					mcpServers: {
						linear: {
							type: "streamableHttp",
							url: "https://mcp.linear.app/mcp",
							disabled: false,
						},
					},
				},
				null,
				2,
			),
		);

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.getClineMcpSettings({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.path).toBe(mcpSettingsPath);
		expect(response.servers).toEqual([
			{
				name: "linear",
				disabled: false,
				type: "streamableHttp",
				url: "https://mcp.linear.app/mcp",
			},
		]);
	});

	it("saves Cline MCP settings", async () => {
		const bumpClineSessionContextVersion = vi.fn();
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			bumpClineSessionContextVersion,
		});

		const response = await api.saveClineMcpSettings(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				servers: [
					{
						name: "linear",
						disabled: false,
						type: "streamableHttp",
						url: "https://mcp.linear.app/mcp",
					},
				],
			},
		);

		expect(response.path).toBe(mcpSettingsPath);
		expect(response.servers).toEqual([
			{
				name: "linear",
				disabled: false,
				type: "streamableHttp",
				url: "https://mcp.linear.app/mcp",
			},
		]);
		expect(bumpClineSessionContextVersion).toHaveBeenCalledTimes(1);
	});

	it("returns MCP auth statuses from persisted OAuth settings", async () => {
		writeFileSync(
			mcpSettingsPath,
			JSON.stringify(
				{
					mcpServers: {
						linear: {
							type: "streamableHttp",
							url: "https://mcp.linear.app/mcp",
						},
						filesystem: {
							type: "stdio",
							command: "npx",
							args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
						},
					},
				},
				null,
				2,
			),
		);
		writeFileSync(
			mcpOauthSettingsPath,
			JSON.stringify(
				{
					servers: {
						linear: {
							tokens: {
								access_token: "token-1",
								token_type: "Bearer",
							},
							lastAuthenticatedAt: 1_700_000_000_000,
						},
					},
				},
				null,
				2,
			),
		);

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.getClineMcpAuthStatuses({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.statuses).toEqual([
			{
				serverName: "filesystem",
				oauthSupported: false,
				oauthConfigured: false,
				lastError: null,
				lastAuthenticatedAt: null,
			},
			{
				serverName: "linear",
				oauthSupported: true,
				oauthConfigured: true,
				lastError: null,
				lastAuthenticatedAt: 1_700_000_000_000,
			},
		]);
	});

	it("rejects MCP OAuth flow for stdio servers", async () => {
		writeFileSync(
			mcpSettingsPath,
			JSON.stringify(
				{
					mcpServers: {
						filesystem: {
							type: "stdio",
							command: "npx",
							args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
						},
					},
				},
				null,
				2,
			),
		);

		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		await expect(
			api.runClineMcpServerOAuth(
				{
					workspaceId: "workspace-1",
					workspacePath: "/tmp/repo",
				},
				{
					serverName: "filesystem",
				},
			),
		).rejects.toThrow("does not support OAuth browser flow");
	});

	it("runs reset teardown before deleting debug state paths", async () => {
		const originalHome = process.env.HOME;
		const tempHome = `/tmp/kanban-reset-home-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		process.env.HOME = tempHome;
		mkdirSync(tempHome, { recursive: true });
		const debugPaths = [
			join(tempHome, ".cline", "data"),
			join(tempHome, ".cline", "kanban"),
			join(tempHome, ".cline", "worktrees"),
		];
		for (const path of debugPaths) {
			mkdirSync(path, { recursive: true });
			writeFileSync(join(path, "marker.txt"), "present");
		}
		const prepareForStateReset = vi.fn(async () => {
			for (const path of debugPaths) {
				expect(existsSync(path)).toBe(true);
			}
		});
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			prepareForStateReset,
		});

		try {
			const response = await api.resetAllState(null);

			expect(response.ok).toBe(true);
			expect(prepareForStateReset).toHaveBeenCalledTimes(1);
			for (const path of debugPaths) {
				expect(existsSync(path)).toBe(false);
			}
		} finally {
			if (originalHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = originalHome;
			}
			rmSync(tempHome, { recursive: true, force: true });
		}
	});

	it("aborts reset path deletion when teardown fails", async () => {
		const originalHome = process.env.HOME;
		const tempHome = `/tmp/kanban-reset-home-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		process.env.HOME = tempHome;
		mkdirSync(tempHome, { recursive: true });
		const debugPaths = [
			join(tempHome, ".cline", "data"),
			join(tempHome, ".cline", "kanban"),
			join(tempHome, ".cline", "worktrees"),
		];
		for (const path of debugPaths) {
			mkdirSync(path, { recursive: true });
			writeFileSync(join(path, "marker.txt"), "present");
		}
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			prepareForStateReset: vi.fn(async () => {
				throw new Error("teardown failed");
			}),
		});

		try {
			await expect(api.resetAllState(null)).rejects.toThrow("teardown failed");
			for (const path of debugPaths) {
				expect(existsSync(path)).toBe(true);
			}
		} finally {
			if (originalHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = originalHome;
			}
			rmSync(tempHome, { recursive: true, force: true });
		}
	});
});

describe("createRuntimeApi getFeaturebaseToken", () => {
	beforeEach(() => {
		oauthMocks.getProviderSettings.mockReset();
		oauthMocks.getLastUsedProviderSettings.mockReset();
		oauthMocks.getValidClineCredentials.mockReset();
		oauthMocks.saveProviderSettings.mockReset();
		clineAccountMocks.fetchFeaturebaseToken.mockReset();
		clineAccountMocks.constructedOptions.length = 0;
	});

	it("returns JWT from SDK method", async () => {
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "workos:oauth-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});
		clineAccountMocks.fetchFeaturebaseToken.mockResolvedValueOnce({
			featurebaseJwt: "jwt-token-123",
		});

		const response = await api.getFeaturebaseToken({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response).toEqual({ featurebaseJwt: "jwt-token-123" });
	});

	it("throws when no provider settings configured", async () => {
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings(null);

		await expect(
			api.getFeaturebaseToken({
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			}),
		).rejects.toThrow("Failed to fetch Featurebase token.");
	});

	it("throws when provider is not cline", async () => {
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "oca",
			auth: {
				accessToken: "some-token",
				refreshToken: "some-refresh",
			},
		});

		await expect(
			api.getFeaturebaseToken({
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			}),
		).rejects.toThrow("Featurebase token requires a Cline provider.");
	});

	it("retries after OAuth refresh when first attempt fails", async () => {
		const api = createRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "workos:stale-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});

		// First attempt fails (e.g. expired token)
		clineAccountMocks.fetchFeaturebaseToken.mockRejectedValueOnce(new Error("Unauthorized"));

		// OAuth refresh returns fresh credentials
		oauthMocks.getValidClineCredentials.mockResolvedValueOnce({
			access: "fresh-access",
			refresh: "fresh-refresh",
			expires: 1_800_000_000_000,
			accountId: "acct-1",
		});

		// Second attempt succeeds with refreshed token
		clineAccountMocks.fetchFeaturebaseToken.mockResolvedValueOnce({
			featurebaseJwt: "refreshed-jwt-456",
		});

		const response = await api.getFeaturebaseToken({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response).toEqual({ featurebaseJwt: "refreshed-jwt-456" });
		expect(clineAccountMocks.fetchFeaturebaseToken).toHaveBeenCalledTimes(2);
		expect(oauthMocks.getValidClineCredentials).toHaveBeenCalledTimes(1);
	});
});
