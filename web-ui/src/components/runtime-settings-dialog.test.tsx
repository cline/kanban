import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RuntimeSettingsDialog } from "@/components/runtime-settings-dialog";
import type { RuntimeConfigResponse } from "@/runtime/types";

const resetLayoutCustomizationsMock = vi.hoisted(() => vi.fn());

vi.mock("@runtime-agent-catalog", () => ({
	getRuntimeAgentCatalogEntry: vi.fn((agentId: string) => ({
		id: agentId,
		installUrl: null,
		autonomousArgs: [],
	})),
	getRuntimeLaunchSupportedAgentCatalog: vi.fn(() => [
		{ id: "cline", label: "Cline", binary: "cline" },
		{ id: "claude", label: "Claude Code", binary: "claude" },
	]),
}));

vi.mock("@runtime-shortcuts", () => ({
	areRuntimeProjectShortcutsEqual: vi.fn(() => true),
}));

vi.mock("@/components/shared/cline-setup-section", () => ({
	ClineSetupSection: () => null,
}));

vi.mock("@/hooks/use-runtime-settings-cline-controller", () => ({
	useRuntimeSettingsClineController: () => ({
		currentProviderSettings: {
			providerId: "anthropic",
			modelId: "claude-3-7-sonnet",
			baseUrl: null,
			reasoningEffort: null,
			apiKeyConfigured: true,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		},
		hasUnsavedChanges: false,
		providerId: "anthropic",
		saveProviderSettings: vi.fn(async () => ({ ok: true })),
	}),
}));

vi.mock("@/hooks/use-runtime-settings-cline-mcp-controller", () => ({
	useRuntimeSettingsClineMcpController: () => ({
		hasUnsavedChanges: false,
		saveMcpSettings: vi.fn(async () => ({ ok: true })),
	}),
}));

vi.mock("@/resize/layout-customizations", () => ({
	useLayoutCustomizations: () => ({
		layoutResetNonce: 0,
		resetLayoutCustomizations: resetLayoutCustomizationsMock,
	}),
}));

vi.mock("@/runtime/use-runtime-config", () => ({
	useRuntimeConfig: (_open: boolean, _workspaceId: string | null, initialConfig?: RuntimeConfigResponse | null) => ({
		config: initialConfig ?? null,
		isLoading: false,
		isSaving: false,
		save: vi.fn(async () => true),
	}),
}));

vi.mock("@/runtime/runtime-config-query", () => ({
	openFileOnHost: vi.fn(async () => undefined),
}));

vi.mock("@/utils/notification-permission", () => ({
	getBrowserNotificationPermission: () => "unsupported",
	requestBrowserNotificationPermission: vi.fn(async () => "unsupported"),
}));

function findButtonByText(container: ParentNode, text: string): HTMLButtonElement | null {
	return (Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === text) ??
		null) as HTMLButtonElement | null;
}

const savedClineOauthConfig = {
	selectedAgentId: "cline",
	selectedShortcutLabel: null,
	agentAutonomousModeEnabled: true,
	readyForReviewNotificationsEnabled: false,
	effectiveCommand: "cline",
	detectedCommands: [],
	shortcuts: [],
	commitPromptTemplate: "",
	openPrPromptTemplate: "",
	commitPromptTemplateDefault: "",
	openPrPromptTemplateDefault: "",
	globalConfigPath: null,
	projectConfigPath: null,
	agents: [
		{
			id: "cline",
			label: "Cline",
			binary: "cline",
			command: "cline",
			installed: true,
		},
		{
			id: "claude",
			label: "Claude Code",
			binary: "claude",
			command: "claude",
			installed: true,
		},
	],
	clineProviderSettings: {
		providerId: null,
		modelId: "cline-sonnet",
		baseUrl: null,
		reasoningEffort: null,
		apiKeyConfigured: false,
		oauthProvider: "cline",
		oauthAccessTokenConfigured: true,
		oauthRefreshTokenConfigured: true,
		oauthAccountId: "acc-1",
		oauthExpiresAt: 1_800_000_000_000,
	},
} as unknown as RuntimeConfigResponse;

describe("RuntimeSettingsDialog", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		resetLayoutCustomizationsMock.mockReset();
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
		document.body.innerHTML = "";
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("does not render support actions inside settings", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedClineOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		expect(findButtonByText(document.body, "Send feedback")).toBeNull();
		expect(findButtonByText(document.body, "Report issue")).toBeNull();
	});

	it("calls the layout reset callback when reset layout is clicked", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedClineOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		const resetButton = findButtonByText(document.body, "Reset layout");
		expect(resetButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			resetButton?.click();
		});

		expect(resetLayoutCustomizationsMock).toHaveBeenCalledTimes(1);
	});
});
