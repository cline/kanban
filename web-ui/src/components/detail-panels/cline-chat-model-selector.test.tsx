import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClineChatModelSelector } from "@/components/detail-panels/cline-chat-model-selector";

function renderSelector(root: Root, element: ReactElement): void {
	root.render(element);
}

function findButtonByText(
	text: string,
	predicate?: (button: HTMLButtonElement) => boolean,
): HTMLButtonElement | undefined {
	return Array.from(document.querySelectorAll("button")).find((button) => {
		if (!(button instanceof HTMLButtonElement)) {
			return false;
		}
		if (button.textContent?.trim() !== text) {
			return false;
		}
		return predicate ? predicate(button) : true;
	}) as HTMLButtonElement | undefined;
}

function hasClass(button: HTMLButtonElement, className: string): boolean {
	return button.className.split(/\s+/).includes(className);
}

function isSelectorOptionButton(button: HTMLButtonElement): boolean {
	return hasClass(button, "w-full") && hasClass(button, "px-2.5") && hasClass(button, "py-1.5");
}

describe("ClineChatModelSelector", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;
	let previousScrollIntoView: typeof Element.prototype.scrollIntoView | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		previousScrollIntoView = Element.prototype.scrollIntoView;
		Element.prototype.scrollIntoView = vi.fn();
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
		Element.prototype.scrollIntoView = previousScrollIntoView ?? vi.fn();
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

		const selectedModelButton = findButtonByText("GPT-5.4", isSelectorOptionButton);
		const selectedReasoningButton = findButtonByText("High", isSelectorOptionButton);
		expect(selectedModelButton).toBeInstanceOf(HTMLButtonElement);
		expect(selectedReasoningButton).toBeInstanceOf(HTMLButtonElement);
		if (
			!(selectedModelButton instanceof HTMLButtonElement) ||
			!(selectedReasoningButton instanceof HTMLButtonElement)
		) {
			throw new Error("Expected selected option buttons");
		}

		expect(document.body.textContent).toContain("Model ID");
		expect(document.body.textContent).toContain("Reasoning effort");
		expect(document.body.textContent).toContain("Recommended models");
		expect(document.body.textContent).toContain("Default");
		expect(hasClass(selectedModelButton, "cursor-pointer")).toBe(true);
		expect(hasClass(selectedReasoningButton, "bg-accent")).toBe(true);
		expect(hasClass(selectedReasoningButton, "text-accent-fg")).toBe(true);
		expect(hasClass(selectedReasoningButton, "cursor-pointer")).toBe(true);
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

	it("keeps the selected model row highlighted after another row becomes active", async () => {
		await act(async () => {
			renderSelector(
				root,
				<ClineChatModelSelector
					modelOptions={[
						{ value: "openai/gpt-5.4", label: "GPT-5.4" },
						{ value: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
					]}
					selectedModelId="openai/gpt-5.4"
					selectedModelButtonText="GPT-5.4"
					onSelectModel={() => {}}
					selectedReasoningEffort=""
					onSelectReasoningEffort={() => {}}
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

		const selectedButton = findButtonByText("GPT-5.4", isSelectorOptionButton);
		const otherButton = findButtonByText("Claude Sonnet 4.6", isSelectorOptionButton);
		expect(selectedButton).toBeInstanceOf(HTMLButtonElement);
		expect(otherButton).toBeInstanceOf(HTMLButtonElement);
		if (!(selectedButton instanceof HTMLButtonElement) || !(otherButton instanceof HTMLButtonElement)) {
			throw new Error("Expected model option buttons");
		}

		await act(async () => {
			otherButton.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
			await Promise.resolve();
		});

		expect(hasClass(selectedButton, "bg-accent")).toBe(true);
		expect(hasClass(selectedButton, "text-accent-fg")).toBe(true);
		expect(hasClass(selectedButton, "bg-surface-3")).toBe(false);
		expect(hasClass(otherButton, "bg-surface-3")).toBe(true);
	});

	it("scrolls the selected model into view when opened", async () => {
		const animationFrameCallbacks: FrameRequestCallback[] = [];
		const requestAnimationFrameSpy = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback: FrameRequestCallback) => {
				animationFrameCallbacks.push(callback);
				return animationFrameCallbacks.length;
			});
		const cancelAnimationFrameSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
		const scrollCalls: Array<{ label: string; block: ScrollLogicalPosition | undefined }> = [];
		Element.prototype.scrollIntoView = vi.fn(function (this: Element, options?: ScrollIntoViewOptions) {
			scrollCalls.push({
				label: this.textContent?.trim() ?? "",
				block: options?.block,
			});
		});
		try {
			await act(async () => {
				renderSelector(
					root,
					<ClineChatModelSelector
						modelOptions={[
							{ value: "openai/gpt-5.4", label: "GPT-5.4" },
							{ value: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
							{ value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
						]}
						pinSelectedModelToTop={false}
						selectedModelId="google/gemini-2.5-pro"
						selectedModelButtonText="Gemini 2.5 Pro"
						onSelectModel={() => {}}
						reasoningEnabledModelIds={["openai/gpt-5.4", "google/gemini-2.5-pro"]}
						selectedReasoningEffort=""
						onSelectReasoningEffort={() => {}}
					/>,
				);
				await Promise.resolve();
			});

			const trigger = Array.from(container.querySelectorAll("button")).find((button) =>
				button.textContent?.includes("Gemini 2.5 Pro"),
			);
			expect(trigger).toBeInstanceOf(HTMLButtonElement);
			if (!(trigger instanceof HTMLButtonElement)) {
				throw new Error("Expected combined model selector trigger");
			}

			await act(async () => {
				trigger.click();
				await Promise.resolve();
			});

			const selectedButton = findButtonByText("Gemini 2.5 Pro", isSelectorOptionButton);
			const firstButton = findButtonByText("GPT-5.4", isSelectorOptionButton);
			expect(selectedButton).toBeInstanceOf(HTMLButtonElement);
			expect(firstButton).toBeInstanceOf(HTMLButtonElement);
			if (!(selectedButton instanceof HTMLButtonElement) || !(firstButton instanceof HTMLButtonElement)) {
				throw new Error("Expected model option buttons");
			}

			await act(async () => {
				while (animationFrameCallbacks.length > 0) {
					const callback = animationFrameCallbacks.shift();
					callback?.(performance.now());
					await Promise.resolve();
				}
			});

			expect(hasClass(selectedButton, "bg-accent")).toBe(true);
			expect(hasClass(selectedButton, "text-accent-fg")).toBe(true);
			expect(hasClass(firstButton, "bg-surface-3")).toBe(false);
			expect(scrollCalls).toEqual([{ label: "Gemini 2.5 Pro", block: "center" }]);

			scrollCalls.length = 0;

			await act(async () => {
				firstButton.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
				await Promise.resolve();
			});

			expect(scrollCalls).toEqual([]);

			const selectedModelTrigger = findButtonByText("GPT-5.4", isSelectorOptionButton);
			expect(selectedModelTrigger).toBeInstanceOf(HTMLButtonElement);
			if (!(selectedModelTrigger instanceof HTMLButtonElement)) {
				throw new Error("Expected model option button");
			}

			await act(async () => {
				selectedModelTrigger.click();
				await Promise.resolve();
			});

			await act(async () => {
				while (animationFrameCallbacks.length > 0) {
					const callback = animationFrameCallbacks.shift();
					callback?.(performance.now());
					await Promise.resolve();
				}
			});

			expect(scrollCalls).toEqual([]);
		} finally {
			requestAnimationFrameSpy.mockRestore();
			cancelAnimationFrameSpy.mockRestore();
		}
	});
});
