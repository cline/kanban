import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useState } from "react";

import {
	fetchClineMcpAuthStatuses,
	fetchClineMcpSettings,
	runClineMcpServerOAuth,
	saveClineMcpSettings,
} from "@/runtime/runtime-config-query";
import type { RuntimeAgentId, RuntimeClineMcpServer, RuntimeClineMcpServerAuthStatus } from "@/runtime/types";

interface SaveResult {
	ok: boolean;
	message?: string;
}

interface UseRuntimeSettingsClineMcpControllerOptions {
	open: boolean;
	workspaceId: string | null;
	selectedAgentId: RuntimeAgentId;
	liveAuthStatuses?: RuntimeClineMcpServerAuthStatus[] | null;
}

const LINEAR_MCP_SERVER_NAME = "linear";
const LINEAR_MCP_SERVER_URL = "https://mcp.linear.app/mcp";

export type LinearMcpPresetStatus = "not-configured" | "configured" | "connected";

export interface LinearMcpPreset {
	status: LinearMcpPresetStatus;
	isSettingUp: boolean;
	setup: () => Promise<SaveResult>;
}

export interface UseRuntimeSettingsClineMcpControllerResult {
	mcpSettingsPath: string;
	mcpServers: RuntimeClineMcpServer[];
	mcpAuthStatusByServerName: Record<string, RuntimeClineMcpServerAuthStatus>;
	authenticatingMcpServerName: string | null;
	setMcpServers: Dispatch<SetStateAction<RuntimeClineMcpServer[]>>;
	isLoadingMcpSettings: boolean;
	isSavingMcpSettings: boolean;
	hasUnsavedChanges: boolean;
	saveMcpSettings: () => Promise<SaveResult>;
	runMcpServerOauth: (serverName: string) => Promise<SaveResult>;
	linearMcpPreset: LinearMcpPreset;
}

function normalizeRecord(record: Record<string, string> | undefined): Record<string, string> | undefined {
	if (!record) {
		return undefined;
	}
	const entries = Object.entries(record)
		.map(([key, value]) => [key.trim(), value.trim()] as const)
		.filter(([key, value]) => key.length > 0 && value.length > 0)
		.sort(([left], [right]) => left.localeCompare(right));
	if (entries.length === 0) {
		return undefined;
	}
	return Object.fromEntries(entries);
}

function normalizeMcpServer(server: RuntimeClineMcpServer): RuntimeClineMcpServer {
	if (server.type === "stdio") {
		return {
			name: server.name.trim(),
			disabled: server.disabled,
			type: "stdio",
			command: server.command.trim(),
			args: server.args?.map((value) => value.trim()).filter((value) => value.length > 0),
			cwd: server.cwd?.trim() || undefined,
			env: normalizeRecord(server.env),
		};
	}

	return {
		name: server.name.trim(),
		disabled: server.disabled,
		type: server.type,
		url: server.url.trim(),
		headers: normalizeRecord(server.headers),
	};
}

function normalizeMcpServers(servers: RuntimeClineMcpServer[]): RuntimeClineMcpServer[] {
	return servers.map(normalizeMcpServer).sort((left, right) => left.name.localeCompare(right.name));
}

function buildLinearMcpServer(): RuntimeClineMcpServer {
	return {
		name: LINEAR_MCP_SERVER_NAME,
		disabled: false,
		type: "streamableHttp",
		url: LINEAR_MCP_SERVER_URL,
	};
}

function upsertServerByName(
	servers: RuntimeClineMcpServer[],
	nextServer: RuntimeClineMcpServer,
): RuntimeClineMcpServer[] {
	const normalizedName = nextServer.name.trim().toLowerCase();
	let found = false;
	const nextServers = servers.map((server) => {
		if (server.name.trim().toLowerCase() !== normalizedName) {
			return server;
		}
		found = true;
		return nextServer;
	});
	return found ? nextServers : [...nextServers, nextServer];
}

function areMcpServersEqual(left: RuntimeClineMcpServer[], right: RuntimeClineMcpServer[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return JSON.stringify(normalizeMcpServers(left)) === JSON.stringify(normalizeMcpServers(right));
}

function toSaveError(error: unknown): SaveResult {
	return {
		ok: false,
		message: error instanceof Error ? error.message : String(error),
	};
}

export function useRuntimeSettingsClineMcpController(
	options: UseRuntimeSettingsClineMcpControllerOptions,
): UseRuntimeSettingsClineMcpControllerResult {
	const { open, workspaceId, selectedAgentId, liveAuthStatuses = null } = options;
	const [mcpSettingsPath, setMcpSettingsPath] = useState("");
	const [mcpServers, setMcpServers] = useState<RuntimeClineMcpServer[]>([]);
	const [initialMcpServers, setInitialMcpServers] = useState<RuntimeClineMcpServer[]>([]);
	const [mcpAuthStatusByServerName, setMcpAuthStatusByServerName] = useState<
		Record<string, RuntimeClineMcpServerAuthStatus>
	>({});
	const [authenticatingMcpServerName, setAuthenticatingMcpServerName] = useState<string | null>(null);
	const [isLoadingMcpSettings, setIsLoadingMcpSettings] = useState(false);
	const [isSavingMcpSettings, setIsSavingMcpSettings] = useState(false);

	const reloadAuthStatuses = useCallback(async () => {
		try {
			const response = await fetchClineMcpAuthStatuses(workspaceId);
			setMcpAuthStatusByServerName(
				Object.fromEntries(response.statuses.map((status) => [status.serverName, status] as const)),
			);
		} catch {
			setMcpAuthStatusByServerName({});
		}
	}, [workspaceId]);

	useEffect(() => {
		if (!open || selectedAgentId !== "cline") {
			setIsLoadingMcpSettings(false);
			setMcpSettingsPath("");
			setMcpServers([]);
			setInitialMcpServers([]);
			setMcpAuthStatusByServerName({});
			setAuthenticatingMcpServerName(null);
			return;
		}

		let cancelled = false;
		setIsLoadingMcpSettings(true);
		void Promise.all([fetchClineMcpSettings(workspaceId), fetchClineMcpAuthStatuses(workspaceId)])
			.then(([settingsResponse, authResponse]) => {
				if (cancelled) {
					return;
				}
				const nextServers = normalizeMcpServers(settingsResponse.servers);
				setMcpSettingsPath(settingsResponse.path);
				setMcpServers(nextServers);
				setInitialMcpServers(nextServers);
				setMcpAuthStatusByServerName(
					Object.fromEntries(authResponse.statuses.map((status) => [status.serverName, status] as const)),
				);
			})
			.catch(() => {
				if (cancelled) {
					return;
				}
				setMcpSettingsPath("");
				setMcpServers([]);
				setInitialMcpServers([]);
				setMcpAuthStatusByServerName({});
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingMcpSettings(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [open, selectedAgentId, workspaceId]);

	useEffect(() => {
		if (!open || selectedAgentId !== "cline" || !liveAuthStatuses) {
			return;
		}

		setMcpAuthStatusByServerName(
			Object.fromEntries(liveAuthStatuses.map((status) => [status.serverName, status] as const)),
		);
		setAuthenticatingMcpServerName((current) => {
			const normalizedCurrent = current?.trim().toLowerCase() ?? "";
			if (!normalizedCurrent) {
				return current;
			}
			const matchingStatus = liveAuthStatuses.find(
				(status) => status.serverName.trim().toLowerCase() === normalizedCurrent,
			);
			if (!matchingStatus) {
				return current;
			}
			return matchingStatus.oauthConfigured || matchingStatus.lastError ? null : current;
		});
	}, [liveAuthStatuses, open, selectedAgentId]);

	const hasUnsavedChanges = useMemo(
		() => !areMcpServersEqual(mcpServers, initialMcpServers),
		[initialMcpServers, mcpServers],
	);

	const persistMcpSettings = useCallback(
		async (serversToSave: RuntimeClineMcpServer[]): Promise<SaveResult> => {
			const response = await saveClineMcpSettings(workspaceId, {
				servers: normalizeMcpServers(serversToSave),
			});
			const nextServers = normalizeMcpServers(response.servers);
			setMcpSettingsPath(response.path);
			setMcpServers(nextServers);
			setInitialMcpServers(nextServers);
			await reloadAuthStatuses();
			return { ok: true };
		},
		[reloadAuthStatuses, workspaceId],
	);

	const saveMcpSettings = useCallback(async (): Promise<SaveResult> => {
		if (!hasUnsavedChanges) {
			return { ok: true };
		}
		setIsSavingMcpSettings(true);
		try {
			return await persistMcpSettings(mcpServers);
		} catch (error) {
			return toSaveError(error);
		} finally {
			setIsSavingMcpSettings(false);
		}
	}, [hasUnsavedChanges, mcpServers, persistMcpSettings]);

	const runMcpServerOauth = useCallback(
		async (serverName: string): Promise<SaveResult> => {
			const normalizedServerName = serverName.trim();
			if (!normalizedServerName) {
				return {
					ok: false,
					message: "MCP server name cannot be empty.",
				};
			}
			setAuthenticatingMcpServerName(normalizedServerName);
			try {
				if (hasUnsavedChanges) {
					setIsSavingMcpSettings(true);
					try {
						const saveResult = await persistMcpSettings(mcpServers);
						if (!saveResult.ok) {
							return saveResult;
						}
					} catch (error) {
						return toSaveError(error);
					} finally {
						setIsSavingMcpSettings(false);
					}
				}
				await runClineMcpServerOAuth(workspaceId, {
					serverName: normalizedServerName,
				});
				await reloadAuthStatuses();
				return {
					ok: true,
				};
			} catch (error) {
				await reloadAuthStatuses();
				return toSaveError(error);
			} finally {
				setAuthenticatingMcpServerName(null);
			}
		},
		[hasUnsavedChanges, mcpServers, persistMcpSettings, reloadAuthStatuses, workspaceId],
	);

	const setupLinearMcpServer = useCallback(async (): Promise<SaveResult> => {
		const nextServers = upsertServerByName(mcpServers, buildLinearMcpServer());
		setMcpServers(nextServers);
		setIsSavingMcpSettings(true);
		setAuthenticatingMcpServerName(LINEAR_MCP_SERVER_NAME);
		try {
			const saveResult = await persistMcpSettings(nextServers);
			if (!saveResult.ok) {
				return saveResult;
			}
			await runClineMcpServerOAuth(workspaceId, {
				serverName: LINEAR_MCP_SERVER_NAME,
			});
			await reloadAuthStatuses();
			return {
				ok: true,
			};
		} catch (error) {
			await reloadAuthStatuses();
			return toSaveError(error);
		} finally {
			setIsSavingMcpSettings(false);
			setAuthenticatingMcpServerName(null);
		}
	}, [mcpServers, persistMcpSettings, reloadAuthStatuses, workspaceId]);

	const linearMcpPreset = useMemo((): LinearMcpPreset => {
		const normalizedName = LINEAR_MCP_SERVER_NAME.toLowerCase();
		const server = mcpServers.find((s) => s.name.trim().toLowerCase() === normalizedName);
		const authStatus = server
			? mcpAuthStatusByServerName[server.name]
			: mcpAuthStatusByServerName[LINEAR_MCP_SERVER_NAME];
		const isCorrectlyConfigured =
			server?.disabled === false && server.type === "streamableHttp" && server.url.trim() === LINEAR_MCP_SERVER_URL;
		const isSettingUp = (authenticatingMcpServerName?.trim().toLowerCase() ?? "") === normalizedName;

		let status: LinearMcpPresetStatus;
		if (isCorrectlyConfigured && authStatus?.oauthConfigured) {
			status = "connected";
		} else if (isCorrectlyConfigured) {
			status = "configured";
		} else {
			status = "not-configured";
		}

		return { status, isSettingUp, setup: setupLinearMcpServer };
	}, [mcpServers, mcpAuthStatusByServerName, authenticatingMcpServerName, setupLinearMcpServer]);

	return {
		mcpSettingsPath,
		mcpServers,
		mcpAuthStatusByServerName,
		authenticatingMcpServerName,
		setMcpServers,
		isLoadingMcpSettings,
		isSavingMcpSettings,
		hasUnsavedChanges,
		saveMcpSettings,
		runMcpServerOauth,
		linearMcpPreset,
	};
}
