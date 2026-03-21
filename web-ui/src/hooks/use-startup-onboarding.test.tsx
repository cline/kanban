import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStartupOnboarding, type UseStartupOnboardingResult } from "@/hooks/use-startup-onboarding";
import { LocalStorageKey } from "@/storage/local-storage-store";
import type { RuntimeConfigResponse } from "@/runtime/types";

vi.mock("@/runtime/runtime-config-query", () => ({
	saveRuntimeConfig: vi.fn(),
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
		taskStartSetupAvailability: {
			githubCli: false,
			linearMcp: false,
		},
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
	hasNoProjects,
	runtimeProjectConfig,
	isTaskAgentReady,
	onSnapshot,
}: {
	currentProjectId: string | null;
	hasNoProjects: boolean;
	runtimeProjectConfig: RuntimeConfigResponse | null;
	isTaskAgentReady: boolean | null;
	onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
	const snapshot = useStartupOnboarding({
		currentProjectId,
		hasNoProjects,
		runtimeProjectConfig,
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
					hasNoProjects={true}
					runtimeProjectConfig={null}
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

	it("reopens after a project is added when setup is still incomplete", async () => {
		window.localStorage.setItem(LocalStorageKey.OnboardingDialogShown, "true");
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					currentProjectId={"project-1"}
					hasNoProjects={false}
					runtimeProjectConfig={createRuntimeConfigResponse("cline")}
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
