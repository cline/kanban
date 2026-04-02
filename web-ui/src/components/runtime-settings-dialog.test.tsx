import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RuntimeSettingsDialog } from "@/components/runtime-settings-dialog";
import type { FeaturebaseFeedbackState } from "@/hooks/use-featurebase-feedback-widget";
import type { RuntimeConfigResponse } from "@/runtime/types";

const openFileOnHostMock = vi.hoisted(() => vi.fn());
const useRuntimeConfigMock = vi.hoisted(() => vi.fn());
const useRuntimeSettingsClineControllerMock = vi.hoisted(() => vi.fn());
const useRuntimeSettingsClineMcpControllerMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/shared/cline-setup-section", () => ({
	ClineSetupSection: () => null,
}));

vi.mock("@/runtime/runtime-config-query", () => ({
	openFileOnHost: openFileOnHostMock,
}));

vi.mock("@/runtime/use-runtime-config", () => ({
	useRuntimeConfig: useRuntimeConfigMock,
}));

vi.mock("@/hooks/use-runtime-settings-cline-controller", () => ({
	useRuntimeSettingsClineController: useRuntimeSettingsClineControllerMock,
}));

vi.mock("@/hooks/use-runtime-settings-cline-mcp-controller", () => ({
	useRuntimeSettingsClineMcpController: useRuntimeSettingsClineMcpControllerMock,
}));

vi.mock("@/utils/notification-permission", () => ({
	getBrowserNotificationPermission: () => "unsupported",
	requestBrowserNotificationPermission: vi.fn(async () => "unsupported"),
}));

function createRuntimeConfigResponse(): RuntimeConfigResponse {
	return {
		selectedAgentId: "cline",
		selectedShortcutLabel: null,
		agentAutonomousModeEnabled: true,
		effectiveCommand: null,
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project/.cline/kanban/config.json",
		readyForReviewNotificationsEnabled: true,
		detectedCommands: ["cline", "claude"],
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
			{
				id: "claude",
				label: "Claude Code",
				binary: "claude",
				command: "claude",
				defaultArgs: [],
				installed: true,
				configured: true,
			},
		],
		shortcuts: [],
		clineProviderSettings: {
			providerId: "cline",
			modelId: "sonnet",
			baseUrl: null,
			apiKeyConfigured: false,
			oauthProvider: "cline",
			oauthAccessTokenConfigured: true,
			oauthRefreshTokenConfigured: true,
			oauthAccountId: "acct_123",
			oauthExpiresAt: 123,
		},
		commitPromptTemplate: "",
		openPrPromptTemplate: "",
		commitPromptTemplateDefault: "",
		openPrPromptTemplateDefault: "",
	};
}

function findButtonByText(container: ParentNode, text: string): HTMLButtonElement | null {
	return (Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === text) ??
		null) as HTMLButtonElement | null;
}

describe("RuntimeSettingsDialog", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		useRuntimeConfigMock.mockReset();
		useRuntimeSettingsClineControllerMock.mockReset();
		useRuntimeSettingsClineMcpControllerMock.mockReset();
		openFileOnHostMock.mockReset();
		vi.useFakeTimers();

		useRuntimeConfigMock.mockReturnValue({
			config: createRuntimeConfigResponse(),
			isLoading: false,
			isSaving: false,
			refresh: vi.fn(),
			save: vi.fn(async () => createRuntimeConfigResponse()),
		});
		useRuntimeSettingsClineControllerMock.mockReturnValue({
			hasUnsavedChanges: false,
			providerId: "cline",
			saveProviderSettings: vi.fn(async () => ({ ok: true })),
		});
		useRuntimeSettingsClineMcpControllerMock.mockReturnValue({
			hasUnsavedChanges: false,
			saveMcpSettings: vi.fn(async () => ({ ok: true })),
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
		document.body.innerHTML = "";
		vi.useRealTimers();

		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
			return;
		}
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
			previousActEnvironment;
	});

	it("opens feedback before closing the settings dialog", async () => {
		const callOrder: string[] = [];
		const featurebaseFeedbackState: FeaturebaseFeedbackState = {
			authState: "ready",
			openFeedback: vi.fn(() => {
				callOrder.push("open");
			}),
		};
		const onOpenChange = vi.fn((open: boolean) => {
			callOrder.push(open ? "open-dialog" : "close-dialog");
		});

		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open
					workspaceId="workspace-1"
					initialConfig={createRuntimeConfigResponse()}
					featurebaseFeedbackState={featurebaseFeedbackState}
					onOpenChange={onOpenChange}
				/>,
			);
		});

		const button = findButtonByText(document.body, "Share Feedback");
		expect(button).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			button?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			button?.click();
		});

		expect(featurebaseFeedbackState.openFeedback).toHaveBeenCalledTimes(1);
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(callOrder).toEqual(["open"]);

		await act(async () => {
			vi.advanceTimersByTime(0);
		});

		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(callOrder).toEqual(["open", "close-dialog"]);
	});
});
