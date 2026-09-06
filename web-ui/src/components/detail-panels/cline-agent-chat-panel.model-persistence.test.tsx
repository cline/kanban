import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeClineProviderModel, RuntimeClineReasoningEffort } from "@/runtime/types";

interface MockRuntimeSettingsState {
	providerId: string;
	modelId: string;
	reasoningEffort: RuntimeClineReasoningEffort | "";
	providerModels: RuntimeClineProviderModel[];
	selectedModelSupportsReasoningEffort: boolean;
	isLoadingProviderModels: boolean;
	hasUnsavedChanges: boolean;
	setModelId: ReturnType<typeof vi.fn>;
	setReasoningEffort: ReturnType<typeof vi.fn>;
	saveProviderSettings: ReturnType<typeof vi.fn>;
}

const runtimeSettingsStateRef = vi.hoisted(() => ({
	current: null as MockRuntimeSettingsState | null,
}));

vi.mock("@/hooks/use-runtime-settings-cline-controller", () => ({
	useRuntimeSettingsClineController: () => {
		if (!runtimeSettingsStateRef.current) {
			throw new Error("Expected runtime settings mock state.");
		}
		return runtimeSettingsStateRef.current;
	},
}));

vi.mock("@/hooks/use-cline-chat-panel-controller", () => ({
	useClineChatPanelController: () => ({
		draft: "",
		setDraft: vi.fn(),
		messages: [],
		error: null,
		isSending: false,
		canSend: true,
		canCancel: false,
		showReviewActions: false,
		showAgentProgressIndicator: false,
		showActionFooter: false,
		showCancelAutomaticAction: false,
		handleSendText: vi.fn(),
		handleSendDraft: vi.fn(async () => true),
		handleCancelTurn: vi.fn(),
	}),
}));

vi.mock("@/components/detail-panels/cline-chat-composer", () => ({
	ClineChatComposer: ({ onSelectModel }: { onSelectModel: (modelId: string) => void }) => (
		<div>
			<button type="button" data-testid="select-model" onClick={() => onSelectModel("anthropic/claude-opus-4.6")}>
				Select model
			</button>
		</div>
	),
}));

describe("ClineAgentChatPanel model persistence", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		runtimeSettingsStateRef.current = {
			providerId: "anthropic",
			modelId: "anthropic/claude-sonnet-4.6",
			reasoningEffort: "",
			providerModels: [],
			selectedModelSupportsReasoningEffort: false,
			isLoadingProviderModels: false,
			hasUnsavedChanges: false,
			setModelId: vi.fn(),
			setReasoningEffort: vi.fn(),
			saveProviderSettings: vi.fn(async () => ({ ok: true })),
		};
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		vi.restoreAllMocks();
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

	it("persists detail picker changes to task settings even when the task was inheriting defaults", async () => {
		const onTaskClineSettingsChanged = vi.fn();
		const { ClineAgentChatPanel } = await import("@/components/detail-panels/cline-agent-chat-panel");

		await act(async () => {
			root.render(
				<ClineAgentChatPanel
					taskId="task-1"
					summary={null}
					workspaceId="workspace-1"
					onTaskClineSettingsChanged={onTaskClineSettingsChanged}
				/>,
			);
			await Promise.resolve();
		});

		const selectModelButton = container.querySelector('[data-testid="select-model"]');
		expect(selectModelButton).toBeInstanceOf(HTMLButtonElement);
		if (!(selectModelButton instanceof HTMLButtonElement)) {
			throw new Error("Expected model selection button.");
		}

		await act(async () => {
			selectModelButton.click();
			await Promise.resolve();
		});

		expect(runtimeSettingsStateRef.current?.setModelId).toHaveBeenCalledWith("anthropic/claude-opus-4.6");
		expect(onTaskClineSettingsChanged).toHaveBeenCalledWith({
			providerId: "anthropic",
			modelId: "anthropic/claude-opus-4.6",
			reasoningEffort: "",
		});
		expect(runtimeSettingsStateRef.current?.saveProviderSettings).not.toHaveBeenCalled();
	});

	it("falls back to saving workspace settings when no task override callback exists", async () => {
		const { ClineAgentChatPanel } = await import("@/components/detail-panels/cline-agent-chat-panel");

		await act(async () => {
			root.render(<ClineAgentChatPanel taskId="task-1" summary={null} workspaceId="workspace-1" />);
			await Promise.resolve();
		});

		const selectModelButton = container.querySelector('[data-testid="select-model"]');
		expect(selectModelButton).toBeInstanceOf(HTMLButtonElement);
		if (!(selectModelButton instanceof HTMLButtonElement)) {
			throw new Error("Expected model selection button.");
		}

		await act(async () => {
			selectModelButton.click();
			await Promise.resolve();
		});

		expect(runtimeSettingsStateRef.current?.saveProviderSettings).toHaveBeenCalledWith({
			modelId: "anthropic/claude-opus-4.6",
			reasoningEffort: null,
		});
	});
});
