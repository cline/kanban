import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRuntimeSettingsClineMcpController } from "@/hooks/use-runtime-settings-cline-mcp-controller";
import type { RuntimeAgentId, RuntimeClineMcpServer } from "@/runtime/types";

const fetchClineMcpSettingsMock = vi.hoisted(() => vi.fn());
const fetchClineMcpAuthStatusesMock = vi.hoisted(() => vi.fn());
const runClineMcpServerOAuthMock = vi.hoisted(() => vi.fn());
const saveClineMcpSettingsMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/runtime-config-query", () => ({
	fetchClineMcpAuthStatuses: fetchClineMcpAuthStatusesMock,
	fetchClineMcpSettings: fetchClineMcpSettingsMock,
	runClineMcpServerOAuth: runClineMcpServerOAuthMock,
	saveClineMcpSettings: saveClineMcpSettingsMock,
}));

interface HookSnapshot {
	mcpSettingsPath: string;
	mcpServers: RuntimeClineMcpServer[];
	hasUnsavedChanges: boolean;
	isLoadingMcpSettings: boolean;
	authenticatingMcpServerName: string | null;
	setMcpServers: (next: RuntimeClineMcpServer[]) => void;
	saveMcpSettings: () => Promise<{ ok: boolean; message?: string }>;
	runMcpServerOauth: (serverName: string) => Promise<{ ok: boolean; message?: string }>;
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
	onSnapshot,
}: {
	open: boolean;
	workspaceId: string | null;
	selectedAgentId: RuntimeAgentId;
	onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
	const state = useRuntimeSettingsClineMcpController({
		open,
		workspaceId,
		selectedAgentId,
	});

	useEffect(() => {
		onSnapshot({
			mcpSettingsPath: state.mcpSettingsPath,
			mcpServers: state.mcpServers,
			hasUnsavedChanges: state.hasUnsavedChanges,
			isLoadingMcpSettings: state.isLoadingMcpSettings,
			authenticatingMcpServerName: state.authenticatingMcpServerName,
			setMcpServers: (next) => {
				state.setMcpServers(next);
			},
			saveMcpSettings: state.saveMcpSettings,
			runMcpServerOauth: state.runMcpServerOauth,
		});
	}, [onSnapshot, state]);

	return null;
}

describe("useRuntimeSettingsClineMcpController", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		fetchClineMcpSettingsMock.mockReset();
		fetchClineMcpAuthStatusesMock.mockReset();
		runClineMcpServerOAuthMock.mockReset();
		saveClineMcpSettingsMock.mockReset();
		fetchClineMcpSettingsMock.mockResolvedValue({
			path: "/tmp/cline_mcp_settings.json",
			servers: [],
		});
		fetchClineMcpAuthStatusesMock.mockResolvedValue({
			statuses: [],
		});
		runClineMcpServerOAuthMock.mockResolvedValue({
			serverName: "linear",
			authorized: true,
			message: "Authorized",
		});
		saveClineMcpSettingsMock.mockResolvedValue({
			path: "/tmp/cline_mcp_settings.json",
			servers: [],
		});
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

	it("loads MCP settings when Cline is selected", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		fetchClineMcpSettingsMock.mockResolvedValue({
			path: "/tmp/cline_mcp_settings.json",
			servers: [
				{
					name: "linear",
					disabled: false,
					transport: {
						type: "streamableHttp",
						url: "https://mcp.linear.app/mcp",
					},
				},
			],
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="cline"
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

		expect(fetchClineMcpSettingsMock).toHaveBeenCalledWith("workspace-1");
		expect(fetchClineMcpAuthStatusesMock).toHaveBeenCalledWith("workspace-1");
		expect(requireSnapshot(latestSnapshot).mcpSettingsPath).toBe("/tmp/cline_mcp_settings.json");
		expect(requireSnapshot(latestSnapshot).mcpServers).toHaveLength(1);
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});

	it("tracks unsaved MCP changes and persists them", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		fetchClineMcpSettingsMock.mockResolvedValue({
			path: "/tmp/cline_mcp_settings.json",
			servers: [],
		});
		saveClineMcpSettingsMock.mockResolvedValue({
			path: "/tmp/cline_mcp_settings.json",
			servers: [
				{
					name: "linear",
					disabled: false,
					transport: {
						type: "streamableHttp",
						url: "https://mcp.linear.app/mcp",
					},
				},
			],
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId={null}
					selectedAgentId="cline"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).setMcpServers([
				{
					name: "linear",
					disabled: false,
					transport: {
						type: "streamableHttp",
						url: "https://mcp.linear.app/mcp",
					},
				},
			]);
			await flushAsyncWork();
		});

		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(true);

		await act(async () => {
			expect(await requireSnapshot(latestSnapshot).saveMcpSettings()).toEqual({ ok: true });
		});

		expect(saveClineMcpSettingsMock).toHaveBeenCalledWith(null, {
			servers: [
				{
					name: "linear",
					disabled: false,
					transport: {
						type: "streamableHttp",
						url: "https://mcp.linear.app/mcp",
					},
				},
			],
		});
		expect(fetchClineMcpAuthStatusesMock).toHaveBeenCalledWith(null);
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});

	it("runs MCP OAuth and refreshes auth statuses", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		fetchClineMcpSettingsMock.mockResolvedValue({
			path: "/tmp/cline_mcp_settings.json",
			servers: [
				{
					name: "linear",
					disabled: false,
					transport: {
						type: "streamableHttp",
						url: "https://mcp.linear.app/mcp",
					},
				},
			],
		});
		fetchClineMcpAuthStatusesMock
			.mockResolvedValueOnce({
				statuses: [
					{
						serverName: "linear",
						oauthSupported: true,
						oauthConfigured: false,
						lastError: null,
						lastAuthenticatedAt: null,
					},
				],
			})
			.mockResolvedValueOnce({
				statuses: [
					{
						serverName: "linear",
						oauthSupported: true,
						oauthConfigured: true,
						lastError: null,
						lastAuthenticatedAt: 1_700_000_000_000,
					},
				],
			});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="cline"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			expect(await requireSnapshot(latestSnapshot).runMcpServerOauth("linear")).toEqual({ ok: true });
		});

		expect(runClineMcpServerOAuthMock).toHaveBeenCalledWith("workspace-1", {
			serverName: "linear",
		});
		expect(fetchClineMcpAuthStatusesMock).toHaveBeenCalledTimes(2);
		expect(requireSnapshot(latestSnapshot).authenticatingMcpServerName).toBeNull();
	});

	it("saves unsaved MCP settings before running OAuth", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		fetchClineMcpSettingsMock.mockResolvedValue({
			path: "/tmp/cline_mcp_settings.json",
			servers: [
				{
					name: "linear",
					disabled: false,
					transport: {
						type: "streamableHttp",
						url: "https://old.linear.app/mcp",
					},
				},
			],
		});
		saveClineMcpSettingsMock.mockResolvedValue({
			path: "/tmp/cline_mcp_settings.json",
			servers: [
				{
					name: "linear",
					disabled: false,
					transport: {
						type: "streamableHttp",
						url: "https://mcp.linear.app/mcp",
					},
				},
			],
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="cline"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).setMcpServers([
				{
					name: "linear",
					disabled: false,
					transport: {
						type: "streamableHttp",
						url: "https://mcp.linear.app/mcp",
					},
				},
			]);
			await flushAsyncWork();
		});

		await act(async () => {
			expect(await requireSnapshot(latestSnapshot).runMcpServerOauth("linear")).toEqual({ ok: true });
		});

		expect(saveClineMcpSettingsMock).toHaveBeenCalledBefore(runClineMcpServerOAuthMock);
		expect(saveClineMcpSettingsMock).toHaveBeenCalledWith("workspace-1", {
			servers: [
				{
					name: "linear",
					disabled: false,
					transport: {
						type: "streamableHttp",
						url: "https://mcp.linear.app/mcp",
					},
				},
			],
		});
		expect(runClineMcpServerOAuthMock).toHaveBeenCalledWith("workspace-1", {
			serverName: "linear",
		});
	});

	it("does not load MCP settings when a non-Cline agent is selected", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="claude"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		expect(fetchClineMcpSettingsMock).not.toHaveBeenCalled();
		expect(fetchClineMcpAuthStatusesMock).not.toHaveBeenCalled();
		expect(requireSnapshot(latestSnapshot).mcpServers).toEqual([]);
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});
});
