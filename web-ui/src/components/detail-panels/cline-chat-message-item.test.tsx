import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ClineChatMessageItem } from "@/components/detail-panels/cline-chat-message-item";
import type { ClineChatMessage } from "@/hooks/use-cline-chat-session";
import { LocalStorageKey } from "@/storage/local-storage-store";

function createReasoningMessage(id: string, streaming: boolean): ClineChatMessage {
	return {
		id,
		role: "reasoning",
		content: `reasoning content ${id}`,
		createdAt: 1,
		meta: {
			hookEventName: streaming ? "reasoning_delta" : "reasoning_end",
			streamType: "reasoning",
		},
	};
}

function getReasoningToggle(container: HTMLElement): HTMLButtonElement {
	const toggle = Array.from(container.querySelectorAll("button")).find((button) =>
		button.textContent?.includes("Reasoning"),
	);
	expect(toggle).toBeInstanceOf(HTMLButtonElement);
	if (!(toggle instanceof HTMLButtonElement)) {
		throw new Error("Expected reasoning toggle button");
	}
	return toggle;
}

describe("ClineChatMessageItem", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	function render(element: ReactElement): void {
		root.render(element);
	}

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		window.localStorage.clear();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		window.localStorage.clear();
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("mounts streaming reasoning expanded by default", async () => {
		await act(async () => {
			render(<ClineChatMessageItem message={createReasoningMessage("reasoning-1", true)} />);
		});

		expect(container.textContent).toContain("reasoning content reasoning-1");
	});

	it("mounts streaming reasoning collapsed when the collapsed preference is set", async () => {
		window.localStorage.setItem(LocalStorageKey.ReasoningCollapsed, "true");

		await act(async () => {
			render(<ClineChatMessageItem message={createReasoningMessage("reasoning-1", true)} />);
		});

		expect(container.textContent).not.toContain("reasoning content reasoning-1");
	});

	it("carries a manual collapse to the next reasoning block", async () => {
		await act(async () => {
			render(<ClineChatMessageItem message={createReasoningMessage("reasoning-1", true)} />);
		});
		await act(async () => {
			getReasoningToggle(container).click();
		});

		expect(container.textContent).not.toContain("reasoning content reasoning-1");
		expect(window.localStorage.getItem(LocalStorageKey.ReasoningCollapsed)).toBe("true");

		await act(async () => {
			render(
				<>
					<ClineChatMessageItem message={createReasoningMessage("reasoning-1", true)} />
					<ClineChatMessageItem message={createReasoningMessage("reasoning-2", true)} />
				</>,
			);
		});

		expect(container.textContent).not.toContain("reasoning content reasoning-2");
	});

	it("still allows manually expanding a block while the collapsed preference is set", async () => {
		window.localStorage.setItem(LocalStorageKey.ReasoningCollapsed, "true");

		await act(async () => {
			render(<ClineChatMessageItem message={createReasoningMessage("reasoning-1", true)} />);
		});
		await act(async () => {
			getReasoningToggle(container).click();
		});

		expect(container.textContent).toContain("reasoning content reasoning-1");
	});

	it("restores streaming auto-expand once a block is expanded", async () => {
		window.localStorage.setItem(LocalStorageKey.ReasoningCollapsed, "true");

		await act(async () => {
			render(<ClineChatMessageItem message={createReasoningMessage("reasoning-1", true)} />);
		});
		await act(async () => {
			getReasoningToggle(container).click();
		});

		expect(window.localStorage.getItem(LocalStorageKey.ReasoningCollapsed)).toBe("false");

		await act(async () => {
			render(
				<>
					<ClineChatMessageItem message={createReasoningMessage("reasoning-1", true)} />
					<ClineChatMessageItem message={createReasoningMessage("reasoning-2", true)} />
				</>,
			);
		});

		expect(container.textContent).toContain("reasoning content reasoning-2");
	});
});
