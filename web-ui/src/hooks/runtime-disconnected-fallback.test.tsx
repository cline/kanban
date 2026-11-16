import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RuntimeDisconnectedFallback } from "@/hooks/runtime-disconnected-fallback";

async function render(root: Root, node: ReactElement): Promise<void> {
	await act(async () => {
		root.render(node);
	});
}

describe("RuntimeDisconnectedFallback", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	});

	it("tells the user Kanban disconnected, not to run the Cline CLI", async () => {
		await render(root, <RuntimeDisconnectedFallback />);

		expect(container.textContent).toContain("Disconnected from Kanban");
		expect(container.textContent).toMatch(/reload this tab/i);
		expect(container.textContent).not.toMatch(/cline/i);
	});
});
