import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClineChatModelSelector } from "@/components/detail-panels/cline-chat-model-selector";

function renderSelector(root: Root, element: ReactElement): void {
	root.render(element);
}

describe("ClineChatModelSelector", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
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

	it("shows model and reasoning menus inside one popover", async () => {
		await act(async () => {
			renderSelector(
				root,
				<ClineChatModelSelector
					modelOptions={[
						{ value: "openai/gpt-5.4", label: "GPT-5.4" },
						{ value: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
					]}
					recommendedModelIds={["openai/gpt-5.4"]}
					selectedModelId="openai/gpt-5.4"
					selectedModelButtonText="GPT-5.4 (High)"
					onSelectModel={() => {}}
					reasoningEnabledModelIds={["openai/gpt-5.4"]}
					selectedReasoningEffort="high"
					onSelectReasoningEffort={() => {}}
				/>,
			);
			await Promise.resolve();
		});

		const trigger = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("GPT-5.4 (High)"),
		);
		expect(trigger).toBeInstanceOf(HTMLButtonElement);
		if (!(trigger instanceof HTMLButtonElement)) {
			throw new Error("Expected combined model selector trigger");
		}

		await act(async () => {
			trigger.click();
			await Promise.resolve();
		});

		expect(document.body.textContent).toContain("Model ID");
		expect(document.body.textContent).toContain("Reasoning effort");
		expect(document.body.textContent).toContain("Recommended models");
		expect(document.body.textContent).toContain("Default");
	});

	it("saves the selected reasoning effort", async () => {
		const onSelectReasoningEffort = vi.fn();

		await act(async () => {
			renderSelector(
				root,
				<ClineChatModelSelector
					modelOptions={[{ value: "openai/gpt-5.4", label: "GPT-5.4" }]}
					selectedModelId="openai/gpt-5.4"
					selectedModelButtonText="GPT-5.4"
					onSelectModel={() => {}}
					reasoningEnabledModelIds={["openai/gpt-5.4"]}
					selectedReasoningEffort=""
					onSelectReasoningEffort={onSelectReasoningEffort}
				/>,
			);
			await Promise.resolve();
		});

		const trigger = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("GPT-5.4"),
		);
		expect(trigger).toBeInstanceOf(HTMLButtonElement);
		if (!(trigger instanceof HTMLButtonElement)) {
			throw new Error("Expected combined model selector trigger");
		}

		await act(async () => {
			trigger.click();
			await Promise.resolve();
		});

		const highButton = Array.from(document.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "High",
		);
		expect(highButton).toBeInstanceOf(HTMLButtonElement);
		if (!(highButton instanceof HTMLButtonElement)) {
			throw new Error("Expected reasoning option button");
		}

		await act(async () => {
			highButton.click();
			await Promise.resolve();
		});

		expect(onSelectReasoningEffort).toHaveBeenCalledWith("high");
	});
});
