import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { UsePromptsLibraryResult } from "@/hooks/use-prompts-library";
import type { RuntimePromptItem } from "@/runtime/types";

import { PromptsLibraryView } from "./prompts-library-view";

function renderView(root: import("react-dom/client").Root, library: UsePromptsLibraryResult): void {
	root.render(
		<TooltipProvider>
			<PromptsLibraryView library={library} />
		</TooltipProvider>,
	);
}

function createMockPrompt(overrides: Partial<RuntimePromptItem> = {}): RuntimePromptItem {
	return {
		promptId: "test-prompt",
		githubUrl: "https://github.com/cline/prompts/blob/main/.clinerules/test-prompt.md",
		name: "Test Prompt",
		author: "testauthor",
		description: "A test prompt for unit testing",
		category: "Testing",
		tags: ["test", "example"],
		type: "rule",
		content: "# Test Prompt\n\nContent here.",
		version: "1.0.0",
		globs: [],
		createdAt: "2025-01-01T00:00:00Z",
		updatedAt: "2025-01-01T00:00:00Z",
		...overrides,
	};
}

function createMockLibrary(overrides: Partial<UsePromptsLibraryResult> = {}): UsePromptsLibraryResult {
	return {
		catalog: [],
		filteredPrompts: [],
		isLoading: false,
		errorMessage: null,
		searchQuery: "",
		setSearchQuery: vi.fn(),
		typeFilter: "all",
		setTypeFilter: vi.fn(),
		appliedPromptIds: new Set(),
		applyPrompt: vi.fn(),
		removePrompt: vi.fn(),
		isApplyingOrRemoving: false,
		refresh: vi.fn(),
		expandedPromptId: null,
		toggleExpandedPrompt: vi.fn(),
		...overrides,
	};
}

describe("PromptsLibraryView", () => {
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

	it("renders loading state", async () => {
		const library = createMockLibrary({ isLoading: true });
		await act(async () => {
			renderView(root, library);
		});

		expect(container.textContent).toContain("Loading community prompts");
	});

	it("renders error state with retry button", async () => {
		const library = createMockLibrary({ errorMessage: "Network error" });
		await act(async () => {
			renderView(root, library);
		});

		expect(container.textContent).toContain("Network error");
		const retryButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Retry",
		);
		expect(retryButton).toBeDefined();
	});

	it("renders empty state when no prompts match search", async () => {
		const library = createMockLibrary({ searchQuery: "nonexistent" });
		await act(async () => {
			renderView(root, library);
		});

		expect(container.textContent).toContain("No prompts match your search");
	});

	it("renders prompt cards with name, description, author, and type badge", async () => {
		const prompt = createMockPrompt();
		const library = createMockLibrary({ catalog: [prompt], filteredPrompts: [prompt] });
		await act(async () => {
			renderView(root, library);
		});

		expect(container.textContent).toContain("Test Prompt");
		expect(container.textContent).toContain("A test prompt for unit testing");
		expect(container.textContent).toContain("testauthor");
		expect(container.textContent).toContain("rule");
	});

	it("shows Applied badge and Remove button for applied prompts", async () => {
		const prompt = createMockPrompt();
		const library = createMockLibrary({
			catalog: [prompt],
			filteredPrompts: [prompt],
			appliedPromptIds: new Set(["rule:test-prompt"]),
		});
		await act(async () => {
			renderView(root, library);
		});

		expect(container.textContent).toContain("Applied");
		const removeButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Remove",
		);
		expect(removeButton).toBeDefined();
	});

	it("shows Apply button for unapplied prompts", async () => {
		const prompt = createMockPrompt();
		const library = createMockLibrary({ catalog: [prompt], filteredPrompts: [prompt] });
		await act(async () => {
			renderView(root, library);
		});

		const applyButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Apply",
		);
		expect(applyButton).toBeDefined();
	});

	it("displays prompt count in header", async () => {
		const prompts = [
			createMockPrompt({ promptId: "a", name: "Prompt A" }),
			createMockPrompt({ promptId: "b", name: "Prompt B" }),
		];
		const library = createMockLibrary({ catalog: prompts, filteredPrompts: prompts });
		await act(async () => {
			renderView(root, library);
		});

		expect(container.textContent).toContain("2 prompts");
	});

	it("renders search input and type filter tabs", async () => {
		const library = createMockLibrary();
		await act(async () => {
			renderView(root, library);
		});

		const searchInput = container.querySelector('input[placeholder="Search prompts…"]');
		expect(searchInput).toBeInstanceOf(HTMLInputElement);

		expect(container.textContent).toContain("All");
		expect(container.textContent).toContain("Rules");
		expect(container.textContent).toContain("Workflows");
	});

	it("renders workflow type badge correctly", async () => {
		const prompt = createMockPrompt({ type: "workflow", promptId: "wf-1", name: "My Workflow" });
		const library = createMockLibrary({ catalog: [prompt], filteredPrompts: [prompt] });
		await act(async () => {
			renderView(root, library);
		});

		expect(container.textContent).toContain("workflow");
		expect(container.textContent).toContain("My Workflow");
	});
});
