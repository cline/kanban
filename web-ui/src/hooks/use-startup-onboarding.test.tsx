import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStartupOnboarding, type UseStartupOnboardingResult } from "@/hooks/use-startup-onboarding";
import { LocalStorageKey } from "@/storage/local-storage-store";
import type { RuntimeConfigResponse } from "@/runtime/types";

const saveRuntimeConfigMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/runtime-config-query", () => ({
	saveRuntimeConfig: saveRuntimeConfigMock,
}));

type HookSnapshot = UseStartupOnboardingResult;

function createRuntimeConfigResponse(selectedAgentId: RuntimeConfigResponse["selectedAgentId"]): RuntimeConfigResponse {
	return {
		selectedAgentId,
		selectedShortcutLabel: null,
		agentAutonomousModeEnabled: true,
		effectiveCommand: selectedAgentId,
		globalConfigPath: "/tmp/.cline/kanban/config.json",
		projectConfigPath: "/tmp/project/.cline/kanban/config.json",
		readyForReviewNotificationsEnabled: true,
		detectedCommands: ["codex"],
		agents: [
			{
				id: "codex",
				label: "OpenAI Codex",
				binary: "codex",
				command: "codex",
				defaultArgs: [],
				installed: true,
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
	};
}

function HookHarness({
	currentProjectId,
	runtimeProjectConfig,
	isRuntimeProjectConfigLoading,
	isTaskAgentReady,
	onSnapshot,
}: {
	currentProjectId: string | null;
	runtimeProjectConfig: RuntimeConfigResponse | null;
	isRuntimeProjectConfigLoading: boolean;
	isTaskAgentReady: boolean | null;
	onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
	const snapshot = useStartupOnboarding({
		currentProjectId,
		runtimeProjectConfig,
		isRuntimeProjectConfigLoading,
		isTaskAgentReady,
		refreshRuntimeProjectConfig: () => {},
		refreshSettingsRuntimeProjectConfig: () => {},
	});

	useEffect(() => {
		onSnapshot(snapshot);
	}, [onSnapshot, snapshot]);

	return null;
}

describe("useStartupOnboarding", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		window.localStorage.clear();
		saveRuntimeConfigMock.mockReset();
		saveRuntimeConfigMock.mockResolvedValue(createRuntimeConfigResponse("codex"));
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

	it("opens startup onboarding on first launch even before any project exists", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					currentProjectId={null}
					runtimeProjectConfig={null}
					isRuntimeProjectConfigLoading={false}
					isTaskAgentReady={null}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a startup onboarding snapshot.");
		}

		const snapshot = latestSnapshot as HookSnapshot;
		expect(snapshot.isStartupOnboardingDialogOpen).toBe(true);
	});

	it("saves the selected agent without requiring a project", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					currentProjectId={null}
					runtimeProjectConfig={createRuntimeConfigResponse("cline")}
					isRuntimeProjectConfigLoading={false}
					isTaskAgentReady={false}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a startup onboarding snapshot.");
		}

		const snapshot = latestSnapshot as HookSnapshot;
		const result = await snapshot.handleSelectOnboardingAgent("codex");

		expect(result).toEqual({ ok: true });
		expect(saveRuntimeConfigMock).toHaveBeenCalledWith(null, { selectedAgentId: "codex" });
	});

	it("waits for runtime config to finish loading before opening onboarding", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					currentProjectId={null}
					runtimeProjectConfig={null}
					isRuntimeProjectConfigLoading={true}
					isTaskAgentReady={null}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a startup onboarding snapshot.");
		}

		const snapshot = latestSnapshot as HookSnapshot;
		expect(snapshot.isStartupOnboardingDialogOpen).toBe(false);
	});

	it("reopens after a project is added when setup is still incomplete", async () => {
		window.localStorage.setItem(LocalStorageKey.OnboardingDialogShown, "true");
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					currentProjectId={"project-1"}
					runtimeProjectConfig={createRuntimeConfigResponse("cline")}
					isRuntimeProjectConfigLoading={false}
					isTaskAgentReady={false}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a startup onboarding snapshot.");
		}

		const snapshot = latestSnapshot as HookSnapshot;
		expect(snapshot.isStartupOnboardingDialogOpen).toBe(true);
	});
});
