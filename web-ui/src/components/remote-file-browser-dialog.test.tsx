import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RemoteFileBrowserDialog } from "@/components/remote-file-browser-dialog";

/* ------------------------------------------------------------------ */
/* Mock: tRPC client                                                   */
/* ------------------------------------------------------------------ */

const mockQuery = vi.fn();

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		projects: {
			listDirectoryContents: {
				query: mockQuery,
			},
		},
	}),
}));

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeResponse(overrides: Record<string, unknown> = {}) {
	return {
		ok: true,
		currentPath: "/srv/projects",
		parentPath: null,
		rootPath: "/srv/projects",
		entries: [
			{ name: "app-a", path: "/srv/projects/app-a", isGitRepository: true },
			{ name: "app-b", path: "/srv/projects/app-b", isGitRepository: false },
		],
		...overrides,
	};
}

function flushQuery() {
	return act(async () => {
		await new Promise((r) => setTimeout(r, 0));
	});
}

/* ------------------------------------------------------------------ */
/* Test suite                                                          */
/* ------------------------------------------------------------------ */

describe("RemoteFileBrowserDialog", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		mockQuery.mockReset();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
	});

	function renderDialog(
		overrides: { open?: boolean; onSelect?: (p: string) => void; onOpenChange?: (o: boolean) => void } = {},
	) {
		const props = {
			open: true,
			onOpenChange: overrides.onOpenChange ?? (() => {}),
			onSelect: overrides.onSelect ?? (() => {}),
			...overrides,
		};
		act(() => {
			root.render(<RemoteFileBrowserDialog {...props} />);
		});
	}

	// Radix Dialog renders into a portal on document.body
	function q(selector: string) {
		return document.body.querySelector(selector);
	}
	function bodyText() {
		return document.body.textContent ?? "";
	}

	it("does not render dialog content when closed", () => {
		mockQuery.mockResolvedValue(makeResponse());
		renderDialog({ open: false });
		expect(bodyText()).not.toContain("Browse Remote Directory");
	});

	it("renders dialog title and root path when open", async () => {
		mockQuery.mockResolvedValue(makeResponse());
		renderDialog();
		await flushQuery();
		expect(bodyText()).toContain("Browse Remote Directory");
		expect(bodyText()).toContain("Server root: /srv/projects");
	});

	it("shows directory entries after fetch", async () => {
		mockQuery.mockResolvedValue(makeResponse());
		renderDialog();
		await flushQuery();
		expect(bodyText()).toContain("app-a");
		expect(bodyText()).toContain("app-b");
	});

	it("disables Up button when parentPath is null", async () => {
		mockQuery.mockResolvedValue(makeResponse({ parentPath: null }));
		renderDialog();
		await flushQuery();
		const btn = q('[aria-label="Go to parent directory"]') as HTMLButtonElement;
		expect(btn).not.toBeNull();
		expect(btn.disabled).toBe(true);
	});

	it("enables Up button when parentPath is not null", async () => {
		mockQuery.mockResolvedValue(
			makeResponse({ currentPath: "/srv/projects/app-a", parentPath: "/srv/projects", entries: [] }),
		);
		renderDialog();
		await flushQuery();
		const btn = q('[aria-label="Go to parent directory"]') as HTMLButtonElement;
		expect(btn).not.toBeNull();
		expect(btn.disabled).toBe(false);
	});

	it("navigates into a directory on click", async () => {
		mockQuery.mockResolvedValueOnce(makeResponse());
		renderDialog();
		await flushQuery();

		mockQuery.mockResolvedValueOnce(
			makeResponse({
				currentPath: "/srv/projects/app-a",
				parentPath: "/srv/projects",
				entries: [{ name: "src", path: "/srv/projects/app-a/src", isGitRepository: false }],
			}),
		);

		const entry = q('[data-testid="dir-entry-app-a"]') as HTMLButtonElement;
		expect(entry).not.toBeNull();
		act(() => {
			entry.click();
		});
		await flushQuery();

		expect(mockQuery).toHaveBeenCalledTimes(2);
		expect(mockQuery).toHaveBeenLastCalledWith({ path: "/srv/projects/app-a" });
		expect(bodyText()).toContain("src");
	});

	it("fires onSelect with the current path", async () => {
		mockQuery.mockResolvedValue(makeResponse());
		const onSelect = vi.fn();
		renderDialog({ onSelect });
		await flushQuery();

		const selectBtn = Array.from(document.body.querySelectorAll("button")).find(
			(b) => b.textContent?.trim() === "Select",
		)!;
		expect(selectBtn).toBeDefined();
		act(() => {
			selectBtn.click();
		});
		expect(onSelect).toHaveBeenCalledWith("/srv/projects");
	});

	it("shows error message when API returns ok: false", async () => {
		mockQuery.mockResolvedValue(
			makeResponse({ ok: false, error: "Path is outside the server root directory.", entries: [] }),
		);
		renderDialog();
		await flushQuery();
		expect(bodyText()).toContain("Path is outside the server root directory.");
	});

	it("shows empty state when no entries", async () => {
		mockQuery.mockResolvedValue(makeResponse({ entries: [] }));
		renderDialog();
		await flushQuery();
		expect(bodyText()).toContain("This directory is empty.");
	});

	it("shows breadcrumbs for nested path", async () => {
		mockQuery.mockResolvedValue(
			makeResponse({
				currentPath: "/srv/projects/app-a/src",
				parentPath: "/srv/projects/app-a",
				rootPath: "/srv/projects",
				entries: [],
			}),
		);
		renderDialog();
		await flushQuery();
		const bc = q('[aria-label="Breadcrumb"]');
		expect(bc).not.toBeNull();
		expect(bc!.textContent).toContain("/");
		expect(bc!.textContent).toContain("app-a");
		expect(bc!.textContent).toContain("src");
	});

	it("shows git indicator for git directories", async () => {
		mockQuery.mockResolvedValue(makeResponse());
		renderDialog();
		await flushQuery();
		const gitEntry = q('[data-testid="dir-entry-app-a"]');
		expect(gitEntry).not.toBeNull();
		expect(gitEntry!.querySelector('[title="Git repository"]')).not.toBeNull();
	});

	it("navigates up when Up button is clicked", async () => {
		mockQuery.mockResolvedValueOnce(
			makeResponse({ currentPath: "/srv/projects/app-a", parentPath: "/srv/projects", entries: [] }),
		);
		renderDialog();
		await flushQuery();

		mockQuery.mockResolvedValueOnce(makeResponse());
		const upBtn = q('[aria-label="Go to parent directory"]') as HTMLButtonElement;
		expect(upBtn).not.toBeNull();
		act(() => {
			upBtn.click();
		});
		await flushQuery();

		expect(mockQuery).toHaveBeenLastCalledWith({ path: "/srv/projects" });
	});
});
