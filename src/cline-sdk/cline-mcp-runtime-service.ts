import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
	OAuthClientInformationMixed,
	OAuthClientMetadata,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { z } from "zod";

import type { RuntimeClineMcpServer } from "../core/api-contract";
import { buildKanbanRuntimeUrl } from "../core/runtime-endpoint";
import { lockedFileSystem } from "../fs/locked-file-system";
import { createClineMcpSettingsService, resolveMcpSettingsPath } from "./cline-mcp-settings-service";
import {
	createSdkInMemoryMcpManager,
	createSdkMcpTools,
	type SdkMcpManager,
	type SdkMcpServerClient,
	type SdkMcpServerRegistration,
	type SdkMcpTool,
} from "./sdk-provider-boundary";

const DEFAULT_AUTH_TIMEOUT_MS = 3 * 60 * 1000;
const COMPLETED_CALLBACK_RETENTION_MS = 5 * 60 * 1000;
const OAUTH_CALLBACK_PATH = "/kanban-mcp/mcp-oauth-callback";
const OAUTH_CALLBACK_REQUEST_ID_PARAM = "requestId";

const CALLBACK_RESPONSE_HTML = {
	success:
		"<html><body><h1>Authorization complete</h1><p>You can close this tab and return to Cline.</p></body></html>",
	failure: "<html><body><h1>OAuth failed</h1><p>You can close this tab.</p></body></html>",
	missingCode: "<html><body><h1>Missing authorization code</h1><p>You can close this tab.</p></body></html>",
	expired:
		"<html><body><h1>Authorization session expired</h1><p>Return to Cline and run Connect OAuth again.</p></body></html>",
	missingRequestId:
		"<html><body><h1>Invalid authorization callback</h1><p>Return to Cline and run Connect OAuth again.</p></body></html>",
} as const;

const pendingOauthCallbacksByRequestId = new Map<
	string,
	{
		resolveCode: (code: string) => void;
		rejectCode: (error: Error) => void;
		timeoutHandle: NodeJS.Timeout;
	}
>();
const completedOauthCallbacksByRequestId = new Map<
	string,
	{
		response: ClineMcpOauthCallbackResponse;
		timeoutHandle: NodeJS.Timeout;
	}
>();

const oauthServerStateSchema = z.object({
	clientInformation: z.record(z.string(), z.unknown()).optional(),
	tokens: z.record(z.string(), z.unknown()).optional(),
	codeVerifier: z.string().optional(),
	discoveryState: z.record(z.string(), z.unknown()).optional(),
	redirectUrl: z.string().url().optional(),
	lastError: z.string().optional(),
	lastAuthenticatedAt: z.number().int().positive().optional(),
});

const oauthSettingsSchema = z.object({
	servers: z.record(z.string(), oauthServerStateSchema).default({}),
});

type ClineMcpOauthServerState = z.infer<typeof oauthServerStateSchema>;
type ClineMcpOauthSettings = z.infer<typeof oauthSettingsSchema>;

type AuthCapableTransport = SSEClientTransport | StreamableHTTPClientTransport;
type SdkTransport = StdioClientTransport | AuthCapableTransport;

export interface ClineMcpServerAuthStatus {
	serverName: string;
	oauthSupported: boolean;
	oauthConfigured: boolean;
	lastError: string | null;
	lastAuthenticatedAt: number | null;
}

export interface ClineMcpServerAuthResult {
	serverName: string;
	authorized: true;
	message: string;
}

export interface ClineMcpToolBundle {
	tools: SdkMcpTool[];
	warnings: string[];
	dispose: () => Promise<void>;
}

export interface ClineMcpRuntimeService {
	createToolBundle(): Promise<ClineMcpToolBundle>;
	getAuthStatuses(): Promise<ClineMcpServerAuthStatus[]>;
	authorizeServer(input: {
		serverName: string;
		timeoutMs?: number;
		onAuthorizationUrl?: (url: string) => void;
	}): Promise<ClineMcpServerAuthResult>;
}

export interface ClineMcpOauthCallbackResponse {
	statusCode: number;
	body: string;
}

export interface CreateClineMcpRuntimeServiceOptions {
	onAuthStatusesChanged?: (statuses: ClineMcpServerAuthStatus[]) => void | Promise<void>;
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		const message = error.message.trim();
		if (message.length > 0) {
			return message;
		}
	}
	return String(error);
}

function resolveMcpOauthSettingsPath(): string {
	const configuredPath = process.env.CLINE_MCP_OAUTH_SETTINGS_PATH?.trim();
	if (configuredPath) {
		return resolve(configuredPath);
	}
	return join(dirname(resolveMcpSettingsPath()), "cline_mcp_oauth_settings.json");
}

function normalizeOauthServerState(value: ClineMcpOauthServerState): ClineMcpOauthServerState {
	return {
		...(value.clientInformation ? { clientInformation: value.clientInformation } : {}),
		...(value.tokens ? { tokens: value.tokens } : {}),
		...(value.codeVerifier ? { codeVerifier: value.codeVerifier } : {}),
		...(value.discoveryState ? { discoveryState: value.discoveryState } : {}),
		...(value.redirectUrl ? { redirectUrl: value.redirectUrl } : {}),
		...(value.lastError ? { lastError: value.lastError } : {}),
		...(value.lastAuthenticatedAt ? { lastAuthenticatedAt: value.lastAuthenticatedAt } : {}),
	};
}

function isEmptyOauthServerState(value: ClineMcpOauthServerState): boolean {
	return Object.keys(value).length === 0;
}

function parseOauthSettings(path: string): ClineMcpOauthSettings {
	if (!existsSync(path)) {
		return {
			servers: {},
		};
	}

	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(`Failed to parse MCP OAuth settings JSON at "${path}": ${toErrorMessage(error)}`);
	}

	const parsed = oauthSettingsSchema.safeParse(parsedJson);
	if (!parsed.success) {
		const details = parsed.error.issues
			.map((issue) => {
				const issuePath = issue.path.join(".");
				return issuePath.length > 0 ? `${issuePath}: ${issue.message}` : issue.message;
			})
			.join("; ");
		throw new Error(`Invalid MCP OAuth settings at "${path}": ${details}`);
	}

	return {
		servers: Object.fromEntries(
			Object.entries(parsed.data.servers).map(([name, state]) => [name, normalizeOauthServerState(state)]),
		),
	};
}

async function writeOauthSettings(path: string, settings: ClineMcpOauthSettings): Promise<void> {
	await lockedFileSystem.writeJsonFileAtomic(path, settings, {
		lock: {
			path,
			type: "file",
		},
	});
}

async function updateOauthServerState(input: {
	path: string;
	serverName: string;
	updater: (current: ClineMcpOauthServerState) => ClineMcpOauthServerState;
}): Promise<ClineMcpOauthServerState> {
	const settings = parseOauthSettings(input.path);
	const current = settings.servers[input.serverName] ?? {};
	const updated = normalizeOauthServerState(input.updater(current));

	if (isEmptyOauthServerState(updated)) {
		delete settings.servers[input.serverName];
	} else {
		settings.servers[input.serverName] = updated;
	}

	await writeOauthSettings(input.path, settings);
	return updated;
}

function hasAccessToken(tokens: Record<string, unknown> | undefined): boolean {
	if (!tokens) {
		return false;
	}
	const accessToken = tokens.access_token;
	return typeof accessToken === "string" && accessToken.trim().length > 0;
}

function toMcpRegistration(server: RuntimeClineMcpServer): SdkMcpServerRegistration {
	if (server.type === "stdio") {
		return {
			name: server.name,
			disabled: server.disabled,
			transport: {
				type: "stdio",
				command: server.command,
				args: server.args,
				cwd: server.cwd,
				env: server.env,
			},
		};
	}
	return {
		name: server.name,
		disabled: server.disabled,
		transport: {
			type: server.type,
			url: server.url,
			headers: server.headers,
		},
	};
}

function createTransport(input: { server: RuntimeClineMcpServer; oauthProvider?: OAuthClientProvider }): SdkTransport {
	if (input.server.type === "stdio") {
		return new StdioClientTransport({
			command: input.server.command,
			...(input.server.args ? { args: input.server.args } : {}),
			...(input.server.cwd ? { cwd: input.server.cwd } : {}),
			...(input.server.env ? { env: input.server.env } : {}),
			stderr: "ignore",
		});
	}

	if (input.server.type === "sse") {
		return new SSEClientTransport(new URL(input.server.url), {
			authProvider: input.oauthProvider,
			requestInit: input.server.headers
				? {
						headers: input.server.headers,
					}
				: undefined,
		});
	}

	return new StreamableHTTPClientTransport(new URL(input.server.url), {
		authProvider: input.oauthProvider,
		requestInit: input.server.headers
			? {
					headers: input.server.headers,
				}
			: undefined,
	});
}

function isAuthCapableTransport(transport: SdkTransport): transport is AuthCapableTransport {
	return transport instanceof SSEClientTransport || transport instanceof StreamableHTTPClientTransport;
}

function createOauthClientMetadata(redirectUrl: string): OAuthClientMetadata {
	return {
		client_name: "Cline",
		redirect_uris: [redirectUrl],
		grant_types: ["authorization_code", "refresh_token"],
		response_types: ["code"],
		token_endpoint_auth_method: "none",
	};
}

async function createOauthProviderContext(input: {
	settingsPath: string;
	serverName: string;
	redirectUrl: string;
	onAuthorizationUrl?: (url: string) => void;
}) {
	let state = parseOauthSettings(input.settingsPath).servers[input.serverName] ?? {};
	let lastAuthorizationUrl: string | null = null;

	const persist = async (nextState: ClineMcpOauthServerState): Promise<void> => {
		state = await updateOauthServerState({
			path: input.settingsPath,
			serverName: input.serverName,
			updater: () => nextState,
		});
	};

	const patch = async (updater: (current: ClineMcpOauthServerState) => ClineMcpOauthServerState): Promise<void> => {
		state = await updateOauthServerState({
			path: input.settingsPath,
			serverName: input.serverName,
			updater,
		});
	};

	const provider: OAuthClientProvider = {
		get redirectUrl() {
			return state.redirectUrl ?? input.redirectUrl;
		},
		get clientMetadata() {
			return createOauthClientMetadata(state.redirectUrl ?? input.redirectUrl);
		},
		state: () => randomUUID(),
		clientInformation: () => state.clientInformation as OAuthClientInformationMixed | undefined,
		saveClientInformation: async (clientInformation) => {
			await patch((current) => ({
				...current,
				clientInformation: clientInformation as Record<string, unknown>,
				redirectUrl: input.redirectUrl,
				lastError: undefined,
			}));
		},
		tokens: () => state.tokens as OAuthTokens | undefined,
		saveTokens: async (tokens) => {
			await patch((current) => ({
				...current,
				tokens: tokens as Record<string, unknown>,
				redirectUrl: input.redirectUrl,
				lastError: undefined,
				lastAuthenticatedAt: Date.now(),
			}));
		},
		redirectToAuthorization: async (authorizationUrl: URL) => {
			lastAuthorizationUrl = authorizationUrl.toString();
			if (input.onAuthorizationUrl) {
				input.onAuthorizationUrl(lastAuthorizationUrl);
			}
		},
		saveCodeVerifier: async (codeVerifier: string) => {
			await patch((current) => ({
				...current,
				codeVerifier,
				redirectUrl: input.redirectUrl,
			}));
		},
		codeVerifier: () => {
			if (!state.codeVerifier) {
				throw new Error(`Missing OAuth code verifier for MCP server "${input.serverName}".`);
			}
			return state.codeVerifier;
		},
		invalidateCredentials: async (scope) => {
			await patch((current) => {
				if (scope === "all") {
					return {
						lastError: current.lastError,
					};
				}
				return {
					...current,
					...(scope === "client" ? { clientInformation: undefined } : {}),
					...(scope === "tokens" ? { tokens: undefined, lastAuthenticatedAt: undefined } : {}),
					...(scope === "verifier" ? { codeVerifier: undefined } : {}),
					...(scope === "discovery" ? { discoveryState: undefined } : {}),
				};
			});
		},
		saveDiscoveryState: async (discoveryState) => {
			await patch((current) => ({
				...current,
				discoveryState: discoveryState as unknown as Record<string, unknown>,
			}));
		},
		discoveryState: () => state.discoveryState as OAuthDiscoveryState | undefined,
	};

	if (state.redirectUrl !== input.redirectUrl) {
		await persist({
			...state,
			redirectUrl: input.redirectUrl,
		});
	}

	return {
		provider,
		getLastAuthorizationUrl: () => lastAuthorizationUrl,
		resetInteractiveState: async () => {
			await patch((current) => ({
				...current,
				clientInformation: undefined,
				codeVerifier: undefined,
				discoveryState: undefined,
				lastError: undefined,
				redirectUrl: input.redirectUrl,
			}));
		},
		markError: async (errorMessage: string) => {
			await patch((current) => ({
				...current,
				lastError: errorMessage,
			}));
		},
		clearError: async () => {
			await patch((current) => ({
				...current,
				lastError: undefined,
			}));
		},
	};
}

class RuntimeMcpServerClient implements SdkMcpServerClient {
	private client: Client | null = null;

	constructor(
		private readonly server: RuntimeClineMcpServer,
		private readonly oauthSettingsPath: string,
	) {}

	private async createAuthProviderContext() {
		if (this.server.type === "stdio") {
			return null;
		}

		return await createOauthProviderContext({
			settingsPath: this.oauthSettingsPath,
			serverName: this.server.name,
			redirectUrl:
				parseOauthSettings(this.oauthSettingsPath).servers[this.server.name]?.redirectUrl ??
				buildKanbanRuntimeUrl(OAUTH_CALLBACK_PATH),
		});
	}

	private formatUnauthorizedMessage(authUrl: string | null): string {
		if (authUrl) {
			return `MCP server "${this.server.name}" requires OAuth authorization. Open Settings, run Connect OAuth, and complete this URL: ${authUrl}`;
		}
		return `MCP server "${this.server.name}" requires OAuth authorization. Open Settings and run Connect OAuth.`;
	}

	private async withErrorHandling<T>(
		operation: (context: {
			authContext: Awaited<ReturnType<RuntimeMcpServerClient["createAuthProviderContext"]>>;
		}) => Promise<T>,
	): Promise<T> {
		const authContext = await this.createAuthProviderContext();
		try {
			const value = await operation({ authContext });
			await authContext?.clearError();
			return value;
		} catch (error) {
			if (error instanceof UnauthorizedError) {
				const message = this.formatUnauthorizedMessage(authContext?.getLastAuthorizationUrl() ?? null);
				await authContext?.markError(message);
				throw new Error(message);
			}
			const message = toErrorMessage(error);
			await authContext?.markError(message);
			throw new Error(`MCP server "${this.server.name}" failed: ${message}`);
		}
	}

	async connect(): Promise<void> {
		if (this.client) {
			return;
		}

		await this.withErrorHandling(async ({ authContext }) => {
			const transport = createTransport({
				server: this.server,
				oauthProvider: authContext?.provider,
			});
			const client = new Client({
				name: "kanban-mcp-runtime-client",
				version: "1.0.0",
			});

			await client.connect(transport);
			this.client = client;
		});
	}

	async disconnect(): Promise<void> {
		const activeClient = this.client;
		this.client = null;
		if (!activeClient) {
			return;
		}
		await activeClient.close();
	}

	async listTools() {
		if (!this.client) {
			await this.connect();
		}

		const client = this.client;
		if (!client) {
			throw new Error(`MCP server "${this.server.name}" is not connected.`);
		}

		return await this.withErrorHandling(async () => {
			const result = await client.listTools();
			return result.tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema:
					tool.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema)
						? (tool.inputSchema as Record<string, unknown>)
						: {},
			}));
		});
	}

	async callTool(request: { name: string; arguments?: Record<string, unknown> }): Promise<unknown> {
		if (!this.client) {
			await this.connect();
		}

		const client = this.client;
		if (!client) {
			throw new Error(`MCP server "${this.server.name}" is not connected.`);
		}

		return await this.withErrorHandling(
			async () =>
				await client.callTool({
					name: request.name,
					...(request.arguments ? { arguments: request.arguments } : {}),
				}),
		);
	}
}

function buildMcpOauthCallbackUrl(requestId: string): string {
	const callbackUrl = new URL(buildKanbanRuntimeUrl(OAUTH_CALLBACK_PATH));
	callbackUrl.searchParams.set(OAUTH_CALLBACK_REQUEST_ID_PARAM, requestId);
	return callbackUrl.toString();
}

function rememberCompletedOauthCallback(requestId: string, response: ClineMcpOauthCallbackResponse): void {
	const existing = completedOauthCallbacksByRequestId.get(requestId);
	if (existing) {
		clearTimeout(existing.timeoutHandle);
	}

	const timeoutHandle = setTimeout(() => {
		completedOauthCallbacksByRequestId.delete(requestId);
	}, COMPLETED_CALLBACK_RETENTION_MS);

	completedOauthCallbacksByRequestId.set(requestId, {
		response,
		timeoutHandle,
	});
}

export async function handleClineMcpOauthCallback(requestUrl: URL): Promise<ClineMcpOauthCallbackResponse | null> {
	if (requestUrl.pathname !== OAUTH_CALLBACK_PATH) {
		return null;
	}

	const requestId = requestUrl.searchParams.get(OAUTH_CALLBACK_REQUEST_ID_PARAM)?.trim();
	if (!requestId) {
		return {
			statusCode: 400,
			body: CALLBACK_RESPONSE_HTML.missingRequestId,
		};
	}

	const completed = completedOauthCallbacksByRequestId.get(requestId);
	if (completed) {
		return completed.response;
	}

	const pending = pendingOauthCallbacksByRequestId.get(requestId);
	if (!pending) {
		return {
			statusCode: 410,
			body: CALLBACK_RESPONSE_HTML.expired,
		};
	}

	pendingOauthCallbacksByRequestId.delete(requestId);
	clearTimeout(pending.timeoutHandle);

	const errorValue = requestUrl.searchParams.get("error")?.trim();
	const errorDescription = requestUrl.searchParams.get("error_description")?.trim();
	const code = requestUrl.searchParams.get("code")?.trim();

	if (errorValue) {
		const response = {
			statusCode: 400,
			body: CALLBACK_RESPONSE_HTML.failure,
		} as const;
		rememberCompletedOauthCallback(requestId, response);
		pending.rejectCode(
			new Error(
				errorDescription
					? `OAuth authorization failed: ${errorValue} (${errorDescription})`
					: `OAuth authorization failed: ${errorValue}`,
			),
		);
		return response;
	}

	if (!code) {
		const response = {
			statusCode: 400,
			body: CALLBACK_RESPONSE_HTML.missingCode,
		} as const;
		rememberCompletedOauthCallback(requestId, response);
		pending.rejectCode(new Error("OAuth callback did not include an authorization code."));
		return response;
	}

	const response = {
		statusCode: 200,
		body: CALLBACK_RESPONSE_HTML.success,
	} as const;
	rememberCompletedOauthCallback(requestId, response);
	pending.resolveCode(code);
	return response;
}

export async function startOauthCallbackListener(timeoutMs: number): Promise<{
	redirectUrl: string;
	awaitAuthorizationCode: () => Promise<string>;
	close: () => Promise<void>;
}> {
	let resolveCode: ((code: string) => void) | null = null;
	let rejectCode: ((error: Error) => void) | null = null;
	let timeoutHandle: NodeJS.Timeout | null = null;
	const requestId = randomUUID();

	const codePromise = new Promise<string>((resolve, reject) => {
		resolveCode = resolve;
		rejectCode = (error: Error) => {
			reject(error);
		};
	});

	timeoutHandle = setTimeout(() => {
		if (!pendingOauthCallbacksByRequestId.delete(requestId)) {
			return;
		}
		rejectCode?.(new Error("Timed out waiting for MCP OAuth authorization callback."));
	}, timeoutMs);
	pendingOauthCallbacksByRequestId.set(requestId, {
		resolveCode: (code) => {
			resolveCode?.(code);
		},
		rejectCode: (error) => {
			rejectCode?.(error);
		},
		timeoutHandle,
	});

	let closed = false;
	const close = async () => {
		if (closed) {
			return;
		}
		closed = true;
		if (timeoutHandle) {
			clearTimeout(timeoutHandle);
			timeoutHandle = null;
		}
		pendingOauthCallbacksByRequestId.delete(requestId);
	};

	return {
		redirectUrl: buildMcpOauthCallbackUrl(requestId),
		awaitAuthorizationCode: async () => await codePromise,
		close,
	};
}

export function createClineMcpRuntimeService(
	options: CreateClineMcpRuntimeServiceOptions = {},
): ClineMcpRuntimeService {
	const settingsService = createClineMcpSettingsService();
	const oauthSettingsPath = resolveMcpOauthSettingsPath();

	const createMcpClient = (registration: SdkMcpServerRegistration): SdkMcpServerClient => {
		const loaded = settingsService.loadSettings().servers.find((server) => server.name === registration.name);
		if (!loaded) {
			throw new Error(`Unknown MCP server "${registration.name}".`);
		}
		return new RuntimeMcpServerClient(loaded, oauthSettingsPath);
	};

	const collectAuthStatuses = (): ClineMcpServerAuthStatus[] => {
		const loadedSettings = settingsService.loadSettings();
		const oauthSettings = parseOauthSettings(oauthSettingsPath);

		return loadedSettings.servers
			.map((server) => {
				const authState = oauthSettings.servers[server.name];
				const oauthSupported = server.type !== "stdio";
				return {
					serverName: server.name,
					oauthSupported,
					oauthConfigured: oauthSupported ? hasAccessToken(authState?.tokens) : false,
					lastError: authState?.lastError ?? null,
					lastAuthenticatedAt: authState?.lastAuthenticatedAt ?? null,
				};
			})
			.sort((left, right) => left.serverName.localeCompare(right.serverName));
	};

	const broadcastAuthStatuses = async () => {
		await options.onAuthStatusesChanged?.(collectAuthStatuses());
	};

	return {
		async createToolBundle(): Promise<ClineMcpToolBundle> {
			const loadedSettings = settingsService.loadSettings();
			if (loadedSettings.servers.length === 0) {
				return {
					tools: [],
					warnings: [],
					dispose: async () => {},
				};
			}

			const manager: SdkMcpManager = createSdkInMemoryMcpManager({
				clientFactory: createMcpClient,
			});

			for (const server of loadedSettings.servers) {
				await manager.registerServer(toMcpRegistration(server));
			}

			const tools: SdkMcpTool[] = [];
			const warnings: string[] = [];

			for (const server of loadedSettings.servers) {
				if (server.disabled) {
					continue;
				}
				try {
					const serverTools = await createSdkMcpTools({
						serverName: server.name,
						provider: manager,
					});
					tools.push(...serverTools);
				} catch (error) {
					warnings.push(`Failed to load MCP server "${server.name}": ${toErrorMessage(error)}`);
				}
			}

			return {
				tools,
				warnings,
				dispose: async () => {
					await manager.dispose();
				},
			};
		},

		async getAuthStatuses(): Promise<ClineMcpServerAuthStatus[]> {
			return collectAuthStatuses();
		},

		async authorizeServer(input): Promise<ClineMcpServerAuthResult> {
			const serverName = input.serverName.trim();
			if (!serverName) {
				throw new Error("MCP server name cannot be empty.");
			}

			const loadedSettings = settingsService.loadSettings();
			const server = loadedSettings.servers.find((entry) => entry.name === serverName);
			if (!server) {
				throw new Error(`MCP server "${serverName}" is not configured.`);
			}
			if (server.disabled) {
				throw new Error(`MCP server "${serverName}" is disabled. Enable it before running OAuth.`);
			}
			if (server.type === "stdio") {
				throw new Error(`MCP server "${serverName}" uses stdio transport and does not support OAuth browser flow.`);
			}

			const callbackListener = await startOauthCallbackListener(input.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS);
			const oauthContext = await createOauthProviderContext({
				settingsPath: oauthSettingsPath,
				serverName,
				redirectUrl: callbackListener.redirectUrl,
				onAuthorizationUrl: (url) => {
					input.onAuthorizationUrl?.(url);
				},
			});

			await oauthContext.resetInteractiveState();

			const transport = createTransport({
				server,
				oauthProvider: oauthContext.provider,
			});
			if (!isAuthCapableTransport(transport)) {
				await callbackListener.close();
				throw new Error(`MCP server "${serverName}" transport does not support OAuth.`);
			}

			const client = new Client({
				name: "kanban-mcp-oauth-client",
				version: "1.0.0",
			});
			let retryClient: Client | null = null;

			try {
				try {
					await client.connect(transport);
					await client.listTools();
					await oauthContext.clearError();
					return {
						serverName,
						authorized: true,
						message: `MCP server "${serverName}" is already authorized.`,
					};
				} catch (error) {
					if (!(error instanceof UnauthorizedError)) {
						throw error;
					}

					const authUrl = oauthContext.getLastAuthorizationUrl();
					if (!authUrl) {
						throw new Error(`MCP server "${serverName}" did not provide an authorization URL.`);
					}

					const authorizationCode = await callbackListener.awaitAuthorizationCode();
					await transport.finishAuth(authorizationCode);
					await broadcastAuthStatuses();

					retryClient = new Client({
						name: "kanban-mcp-oauth-client",
						version: "1.0.0",
					});
					const retryTransport = createTransport({
						server,
						oauthProvider: oauthContext.provider,
					});
					if (!isAuthCapableTransport(retryTransport)) {
						throw new Error(`MCP server "${serverName}" transport does not support OAuth.`);
					}
					await retryClient.connect(retryTransport);
					await retryClient.listTools();
					await oauthContext.clearError();
					return {
						serverName,
						authorized: true,
						message: `MCP server "${serverName}" OAuth authorization completed.`,
					};
				}
			} catch (error) {
				const message = toErrorMessage(error);
				await oauthContext.markError(message);
				await broadcastAuthStatuses().catch(() => undefined);
				throw new Error(message);
			} finally {
				await client.close().catch(() => undefined);
				await retryClient?.close().catch(() => undefined);
				await callbackListener.close();
			}
		},
	};
}
