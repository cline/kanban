import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeConfigResponse } from "@/runtime/types";
import { type UseRuntimeConfigResult, useRuntimeConfig } from "@/runtime/use-runtime-config";

const fetchRuntimeConfigMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/runtime-config-query", () => ({
	fetchRuntimeConfig: fetchRuntimeConfigMock,
	saveRuntimeConfig: vi.fn(),
}));

type HookSnapshot = UseRuntimeConfigResult;

function createRuntimeConfigResponse(selectedAgentId: RuntimeConfigResponse["selectedAgentId"]): RuntimeConfigResponse {
	return {
		selectedAgentId,
		selectedShortcutLabel: null,
		agentAutonomousModeEnabled: true,
		effectiveCommand: selectedAgentId,
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project/.cline/kanban/config.json",
		readyForReviewNotificationsEnabled: true,
		detectedCommands: [selectedAgentId],
		agents: [
			{
				id: "claude",
				label: "Claude Code",
				binary: "claude",
				command: "claude",
				defaultArgs: [],
				installed: selectedAgentId === "claude",
				configured: selectedAgentId === "claude",
			},
			{
				id: "codex",
				label: "OpenAI Codex",
				binary: "codex",
				command: "codex",
				defaultArgs: [],
				installed: selectedAgentId === "codex",
				configured: selectedAgentId === "codex",
			},
		],
		shortcuts: [],
		clineProviderSettings: {
			providerId: null,
			modelId: null,
			baseUrl: null,
			apiKeyConfigured: false,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		},
		commitPromptTemplate: "",
		openPrPromptTemplate: "",
		commitPromptTemplateDefault: "",
		openPrPromptTemplateDefault: "",
		homeAgentPromptHash: "test-hash",
	};
}

function HookHarness({
	open,
	workspaceId,
	initialConfig,
	onSnapshot,
}: {
	open: boolean;
	workspaceId: string | null;
	initialConfig?: RuntimeConfigResponse | null;
	onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
	const snapshot = useRuntimeConfig(open, workspaceId, initialConfig);

	useEffect(() => {
		onSnapshot(snapshot);
	}, [onSnapshot, snapshot]);

	return null;
}

describe("useRuntimeConfig", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		fetchRuntimeConfigMock.mockReset();
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

	it("seeds the dialog with initial config and refreshes when opened", async () => {
		const initialConfig = createRuntimeConfigResponse("claude");
		const refreshedConfig = createRuntimeConfigResponse("codex");
		fetchRuntimeConfigMock.mockResolvedValue(refreshedConfig);
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					open={false}
					workspaceId="project-1"
					initialConfig={initialConfig}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (latestSnapshot === null) {
			throw new Error("Expected an initial hook snapshot.");
		}
		const initialSnapshot = latestSnapshot as HookSnapshot;
		expect(initialSnapshot.config?.selectedAgentId).toBe("claude");
		expect(fetchRuntimeConfigMock).not.toHaveBeenCalled();

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="project-1"
					initialConfig={initialConfig}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a refreshed hook snapshot.");
		}
		const refreshedSnapshot = latestSnapshot as HookSnapshot;
		expect(fetchRuntimeConfigMock).toHaveBeenCalledWith("project-1");
		expect(refreshedSnapshot.config?.selectedAgentId).toBe("codex");
		expect(refreshedSnapshot.isLoading).toBe(false);
	});

	it("fetches runtime config without a selected workspace when the dialog opens", async () => {
		const startupConfig = createRuntimeConfigResponse("codex");
		fetchRuntimeConfigMock.mockResolvedValue(startupConfig);
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId={null}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		expect(fetchRuntimeConfigMock).toHaveBeenCalledWith(null);
		if (latestSnapshot === null) {
			throw new Error("Expected a runtime config snapshot.");
		}
		const snapshot = latestSnapshot as HookSnapshot;
		expect(snapshot.config?.selectedAgentId).toBe("codex");
		expect(snapshot.isLoading).toBe(false);
	});

	it("retries once after an initial load error while settings stay open", async () => {
		const startupConfig = createRuntimeConfigResponse("codex");
		fetchRuntimeConfigMock.mockRejectedValueOnce(new Error("Runtime not ready."));
		fetchRuntimeConfigMock.mockResolvedValueOnce(startupConfig);
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId={null}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(fetchRuntimeConfigMock).toHaveBeenNthCalledWith(1, null);
		expect(fetchRuntimeConfigMock).toHaveBeenNthCalledWith(2, null);
		expect(fetchRuntimeConfigMock).toHaveBeenCalledTimes(2);
		if (latestSnapshot === null) {
			throw new Error("Expected a runtime config snapshot after retry.");
		}
		const snapshot = latestSnapshot as HookSnapshot;
		expect(snapshot.config?.selectedAgentId).toBe("codex");
		expect(snapshot.isLoading).toBe(false);
	});

	it("retries once again after workspace changes", async () => {
		const projectConfig = createRuntimeConfigResponse("claude");
		const globalConfig = createRuntimeConfigResponse("codex");
		fetchRuntimeConfigMock
			.mockRejectedValueOnce(new Error("Project runtime not ready."))
			.mockResolvedValueOnce(projectConfig)
			.mockRejectedValueOnce(new Error("Global runtime not ready."))
			.mockResolvedValueOnce(globalConfig);
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="project-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
			await Promise.resolve();
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId={null}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(fetchRuntimeConfigMock).toHaveBeenNthCalledWith(1, "project-1");
		expect(fetchRuntimeConfigMock).toHaveBeenNthCalledWith(2, "project-1");
		expect(fetchRuntimeConfigMock).toHaveBeenNthCalledWith(3, null);
		expect(fetchRuntimeConfigMock).toHaveBeenNthCalledWith(4, null);
		expect(fetchRuntimeConfigMock).toHaveBeenCalledTimes(4);
		if (latestSnapshot === null) {
			throw new Error("Expected a runtime config snapshot after workspace switch retry.");
		}
		const snapshot = latestSnapshot as HookSnapshot;
		expect(snapshot.config?.selectedAgentId).toBe("codex");
		expect(snapshot.isLoading).toBe(false);
	});
});
