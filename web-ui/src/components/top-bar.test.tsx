import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TopBar } from "@/components/top-bar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { resetWorkspaceMetadataStore, setHomeGitSummary } from "@/stores/workspace-metadata-store";

const isMobileMock = vi.hoisted(() => ({ current: false }));

vi.mock("@/hooks/use-is-mobile", () => ({
	useIsMobile: () => isMobileMock.current,
}));

function findButtonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
	return (Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === text) ??
		null) as HTMLButtonElement | null;
}

function setInputValue(input: HTMLInputElement, value: string): void {
	const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
	descriptor?.set?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("TopBar script shortcut onboarding", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		isMobileMock.current = false;
		resetWorkspaceMetadataStore();
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
		resetWorkspaceMetadataStore();
		isMobileMock.current = false;
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("opens first-shortcut dialog from Run and saves when command is provided", async () => {
		const onCreateFirstShortcut = vi.fn(async () => ({ ok: true }));
		const onRunShortcut = vi.fn();

		await act(async () => {
			root.render(
				<TopBar
					openTargetOptions={[]}
					selectedOpenTargetId="vscode"
					onSelectOpenTarget={() => {}}
					onOpenWorkspace={() => {}}
					canOpenWorkspace={false}
					isOpeningWorkspace={false}
					shortcuts={[]}
					onRunShortcut={onRunShortcut}
					onCreateFirstShortcut={onCreateFirstShortcut}
				/>,
			);
		});

		const runButton = findButtonByText(container, "Run");
		expect(runButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			runButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			runButton?.click();
		});

		expect(document.body.textContent).toContain("Set up your first script shortcut");

		const commandInput = Array.from(document.body.querySelectorAll("input")).find(
			(input) => input.placeholder === "npm run dev",
		) as HTMLInputElement | undefined;
		expect(commandInput).toBeDefined();
		expect(commandInput?.value).toBe("");

		const saveButton = findButtonByText(document.body, "Save");
		expect(saveButton).toBeInstanceOf(HTMLButtonElement);
		expect(saveButton?.disabled).toBe(true);

		await act(async () => {
			if (!commandInput) {
				return;
			}
			setInputValue(commandInput, "pnpm dev");
		});
		expect(saveButton?.disabled).toBe(false);

		await act(async () => {
			saveButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			saveButton?.click();
		});

		expect(onCreateFirstShortcut).toHaveBeenCalledWith({
			label: "Run",
			command: "pnpm dev",
			icon: "play",
		});
		expect(onRunShortcut).not.toHaveBeenCalled();
	});

	it("opens settings when the runtime hint is clicked", async () => {
		const onOpenSettings = vi.fn();

		await act(async () => {
			root.render(
				<TopBar
					openTargetOptions={[]}
					selectedOpenTargetId="vscode"
					onSelectOpenTarget={() => {}}
					onOpenWorkspace={() => {}}
					canOpenWorkspace={false}
					isOpeningWorkspace={false}
					runtimeHint="No agent configured"
					onOpenSettings={onOpenSettings}
				/>,
			);
		});

		const runtimeHintButton = findButtonByText(container, "No agent configured");
		expect(runtimeHintButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			runtimeHintButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			runtimeHintButton?.click();
		});

		expect(onOpenSettings).toHaveBeenCalledTimes(1);
	});
});

const HOME_GIT_SUMMARY = {
	currentBranch: "main",
	upstreamBranch: "origin/main",
	changedFiles: 0,
	additions: 0,
	deletions: 0,
	aheadCount: 2,
	behindCount: 1,
};

function renderTopBarWithGit(root: Root, overrides: Record<string, unknown> = {}): void {
	act(() => {
		root.render(
			<TooltipProvider>
				<TopBar
					openTargetOptions={[]}
					selectedOpenTargetId="vscode"
					onSelectOpenTarget={() => {}}
					onOpenWorkspace={() => {}}
					canOpenWorkspace={false}
					isOpeningWorkspace={false}
					showHomeGitSummary
					onGitFetch={vi.fn()}
					onGitPull={vi.fn()}
					onGitPush={vi.fn()}
					{...overrides}
				/>
			</TooltipProvider>,
		);
	});
}

describe("TopBar mobile git actions", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		isMobileMock.current = true;
		resetWorkspaceMetadataStore();
		setHomeGitSummary(HOME_GIT_SUMMARY);
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
		resetWorkspaceMetadataStore();
		isMobileMock.current = false;
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("exposes fetch, pull, and push in a mobile overflow menu", async () => {
		const onGitFetch = vi.fn();
		const onGitPull = vi.fn();
		const onGitPush = vi.fn();
		renderTopBarWithGit(root, { onGitFetch, onGitPull, onGitPush });

		expect(container.querySelector('[aria-label="Fetch from upstream"]')).toBeNull();
		const menuTrigger = container.querySelector('[aria-label="Git sync actions"]');
		expect(menuTrigger).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			menuTrigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
			(menuTrigger as HTMLButtonElement).click();
		});

		const fetchItem = Array.from(document.body.querySelectorAll("[role='menuitem']")).find((item) =>
			item.textContent?.includes("Fetch"),
		);
		const pullItem = Array.from(document.body.querySelectorAll("[role='menuitem']")).find((item) =>
			item.textContent?.includes("Pull"),
		);
		const pushItem = Array.from(document.body.querySelectorAll("[role='menuitem']")).find((item) =>
			item.textContent?.includes("Push"),
		);
		expect(fetchItem).toBeTruthy();
		expect(pullItem?.textContent).toContain("1");
		expect(pushItem?.textContent).toContain("2");

		await act(async () => {
			fetchItem?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
			(fetchItem as HTMLElement).click();
		});
		expect(onGitFetch).toHaveBeenCalledTimes(1);

		await act(async () => {
			menuTrigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
			(menuTrigger as HTMLButtonElement).click();
		});
		const pullItemAgain = Array.from(document.body.querySelectorAll("[role='menuitem']")).find((item) =>
			item.textContent?.includes("Pull"),
		);
		await act(async () => {
			pullItemAgain?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
			(pullItemAgain as HTMLElement).click();
		});
		expect(onGitPull).toHaveBeenCalledTimes(1);

		await act(async () => {
			menuTrigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
			(menuTrigger as HTMLButtonElement).click();
		});
		const pushItemAgain = Array.from(document.body.querySelectorAll("[role='menuitem']")).find((item) =>
			item.textContent?.includes("Push"),
		);
		await act(async () => {
			pushItemAgain?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
			(pushItemAgain as HTMLElement).click();
		});
		expect(onGitPush).toHaveBeenCalledTimes(1);
	});

	it("hides mobile git actions when the home git summary is missing", () => {
		resetWorkspaceMetadataStore();
		renderTopBarWithGit(root);
		expect(container.querySelector('[aria-label="Git sync actions"]')).toBeNull();
		expect(container.querySelector('[aria-label="Fetch from upstream"]')).toBeNull();
	});

	it("keeps desktop fetch, pull, and push inline", () => {
		isMobileMock.current = false;
		renderTopBarWithGit(root);
		expect(container.querySelector('[aria-label="Git sync actions"]')).toBeNull();
		expect(container.querySelector('[aria-label="Fetch from upstream"]')).toBeInstanceOf(HTMLButtonElement);
		expect(container.querySelector('[aria-label="Pull from upstream"]')).toBeInstanceOf(HTMLButtonElement);
		expect(container.querySelector('[aria-label="Push to upstream"]')).toBeInstanceOf(HTMLButtonElement);
	});
});
