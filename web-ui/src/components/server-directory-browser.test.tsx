import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServerDirectoryBrowser } from "@/components/server-directory-browser";

// Mock the tRPC client
vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		runtime: {
			listDirectories: {
				query: vi.fn().mockResolvedValue({
					directories: [
						{ name: "project-a", path: "/home/project-a" },
						{ name: "project-b", path: "/home/project-b" },
					],
				}),
			},
		},
	}),
}));

describe("ServerDirectoryBrowser", () => {
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

	it("renders the dialog with header when open", async () => {
		await act(async () => {
			root.render(
				<ServerDirectoryBrowser open={true} onOpenChange={() => {}} workspaceId={null} onSelect={() => {}} />,
			);
		});

		const title = document.querySelector('[class*="font-semibold"]');
		expect(title?.textContent).toContain("Select Project Directory");
	});

	it("does not render dialog content when closed", () => {
		act(() => {
			root.render(
				<ServerDirectoryBrowser open={false} onOpenChange={() => {}} workspaceId={null} onSelect={() => {}} />,
			);
		});

		const title = document.querySelector('[class*="font-semibold"]');
		expect(title).toBeNull();
	});

	it("renders Cancel and Select buttons", async () => {
		await act(async () => {
			root.render(
				<ServerDirectoryBrowser open={true} onOpenChange={() => {}} workspaceId={null} onSelect={() => {}} />,
			);
		});

		const buttons = document.querySelectorAll("button");
		const buttonTexts = Array.from(buttons).map((b) => b.textContent?.trim());
		expect(buttonTexts).toContain("Cancel");
		expect(buttonTexts).toContain("Select");
	});

	it("renders the path input and Go button", async () => {
		await act(async () => {
			root.render(
				<ServerDirectoryBrowser open={true} onOpenChange={() => {}} workspaceId={null} onSelect={() => {}} />,
			);
		});

		const input = document.querySelector('input[type="text"]');
		expect(input).not.toBeNull();

		const buttons = document.querySelectorAll("button");
		const goButton = Array.from(buttons).find((b) => b.textContent?.trim() === "Go");
		expect(goButton).toBeDefined();
	});

	it("loads directories when opened", async () => {
		await act(async () => {
			root.render(
				<ServerDirectoryBrowser open={true} onOpenChange={() => {}} workspaceId={null} onSelect={() => {}} />,
			);
		});

		// Wait for async directory loading
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 50));
		});

		// Dialog content is rendered in a portal, so check the full document
		const text = document.body.textContent ?? "";
		expect(text).toContain("project-a");
		expect(text).toContain("project-b");
	});

	it("calls onSelect with the selected path when Select is clicked", async () => {
		const onSelect = vi.fn();

		await act(async () => {
			root.render(
				<ServerDirectoryBrowser open={true} onOpenChange={() => {}} workspaceId={null} onSelect={onSelect} />,
			);
		});

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 50));
		});

		// Click on a directory to select it
		const dirButton = Array.from(document.querySelectorAll('[role="button"]')).find((el) =>
			el.textContent?.includes("project-a"),
		);
		expect(dirButton).toBeDefined();
		await act(async () => {
			dirButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		// Click Select button
		const selectButton = Array.from(document.querySelectorAll("button")).find(
			(b) => b.textContent?.trim() === "Select",
		);
		expect(selectButton).toBeDefined();
		await act(async () => {
			selectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(onSelect).toHaveBeenCalledWith("/home/project-a");
	});
});
