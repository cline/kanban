import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClineAddProviderDialog } from "@/components/shared/cline-add-provider-dialog";

function findButtonByText(container: ParentNode, text: string): HTMLButtonElement | null {
	return (Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === text) ??
		null) as HTMLButtonElement | null;
}

function setInputValue(input: HTMLInputElement, value: string): void {
	const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
	descriptor?.set?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ClineAddProviderDialog", () => {
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
		document.body.innerHTML = "";
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("enables save when the user types a model without pressing Enter", async () => {
		const onSubmit = vi.fn(async () => ({ ok: true }));

		await act(async () => {
			root.render(
				<ClineAddProviderDialog open={true} onOpenChange={() => {}} existingProviderIds={[]} onSubmit={onSubmit} />,
			);
		});

		const inputs = Array.from(document.body.querySelectorAll("input"));
		const providerIdInput = inputs.find((input) => input.placeholder === "my-provider") as
			| HTMLInputElement
			| undefined;
		const providerNameInput = inputs.find((input) => input.placeholder === "My Provider") as
			| HTMLInputElement
			| undefined;
		const baseUrlInput = inputs.find((input) => input.placeholder === "https://api.example.com/v1") as
			| HTMLInputElement
			| undefined;
		const modelInput = inputs.find((input) => input.placeholder === "Type a model ID and press Enter") as
			| HTMLInputElement
			| undefined;
		const saveButton = findButtonByText(document.body, "Add provider");

		expect(providerIdInput).toBeDefined();
		expect(providerNameInput).toBeDefined();
		expect(baseUrlInput).toBeDefined();
		expect(modelInput).toBeDefined();
		expect(saveButton).toBeInstanceOf(HTMLButtonElement);
		expect(saveButton?.disabled).toBe(true);

		await act(async () => {
			if (!providerIdInput || !providerNameInput || !baseUrlInput || !modelInput) {
				return;
			}
			setInputValue(providerIdInput, "my-provider");
			setInputValue(providerNameInput, "My Provider");
			setInputValue(baseUrlInput, "http://localhost:8000/v1");
			setInputValue(modelInput, "qwen2.5-coder:32b");
		});

		expect(saveButton?.disabled).toBe(false);

		await act(async () => {
			saveButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			saveButton?.click();
		});

		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "my-provider",
				name: "My Provider",
				baseUrl: "http://localhost:8000/v1",
				models: ["qwen2.5-coder:32b"],
				defaultModelId: "qwen2.5-coder:32b",
			}),
		);
	});

	it("keeps the header key input focused while typing", async () => {
		await act(async () => {
			root.render(
				<ClineAddProviderDialog
					open={true}
					onOpenChange={() => {}}
					existingProviderIds={[]}
					onSubmit={async () => ({ ok: true })}
				/>,
			);
		});

		const addHeaderButton = findButtonByText(document.body, "Add");
		expect(addHeaderButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			addHeaderButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			addHeaderButton?.click();
		});

		const headerKeyInput = Array.from(document.body.querySelectorAll("input")).find(
			(input) => input.placeholder === "Header name",
		) as HTMLInputElement | undefined;
		expect(headerKeyInput).toBeDefined();

		headerKeyInput?.focus();

		await act(async () => {
			if (!headerKeyInput) {
				return;
			}
			setInputValue(headerKeyInput, "Authorization");
		});

		expect(document.activeElement).toBe(headerKeyInput);
		expect(headerKeyInput?.value).toBe("Authorization");
	});

	it("updates capability toggle state and submits the selected capabilities", async () => {
		const onSubmit = vi.fn(async () => ({ ok: true }));

		await act(async () => {
			root.render(
				<ClineAddProviderDialog open={true} onOpenChange={() => {}} existingProviderIds={[]} onSubmit={onSubmit} />,
			);
		});

		const visionButton = findButtonByText(document.body, "vision");
		const streamingButton = findButtonByText(document.body, "streaming");
		expect(visionButton?.getAttribute("aria-pressed")).toBe("false");
		expect(streamingButton?.getAttribute("aria-pressed")).toBe("true");

		await act(async () => {
			visionButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			visionButton?.click();
			streamingButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			streamingButton?.click();
		});

		expect(visionButton?.getAttribute("aria-pressed")).toBe("true");
		expect(streamingButton?.getAttribute("aria-pressed")).toBe("false");

		const inputs = Array.from(document.body.querySelectorAll("input"));
		const providerIdInput = inputs.find((input) => input.placeholder === "my-provider") as
			| HTMLInputElement
			| undefined;
		const providerNameInput = inputs.find((input) => input.placeholder === "My Provider") as
			| HTMLInputElement
			| undefined;
		const baseUrlInput = inputs.find((input) => input.placeholder === "https://api.example.com/v1") as
			| HTMLInputElement
			| undefined;
		const modelInput = inputs.find((input) => input.placeholder === "Type a model ID and press Enter") as
			| HTMLInputElement
			| undefined;
		const saveButton = findButtonByText(document.body, "Add provider");

		await act(async () => {
			if (!providerIdInput || !providerNameInput || !baseUrlInput || !modelInput) {
				return;
			}
			setInputValue(providerIdInput, "my-provider");
			setInputValue(providerNameInput, "My Provider");
			setInputValue(baseUrlInput, "http://localhost:8000/v1");
			setInputValue(modelInput, "qwen2.5-coder:32b");
		});

		await act(async () => {
			saveButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			saveButton?.click();
		});

		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				capabilities: ["tools", "vision"],
			}),
		);
	});
});
