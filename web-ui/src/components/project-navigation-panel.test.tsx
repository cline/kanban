import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectNavigationPanel } from "@/components/project-navigation-panel";
import type { RuntimeClineProviderSettings, RuntimeProjectSummary } from "@/runtime/types";
import { LocalStorageKey } from "@/storage/local-storage-store";

vi.mock("@/resize/layout-customizations", () => ({
	useLayoutResetEffect: () => {},
}));

const SIDEBAR_MIN_EXPANDED_WIDTH = 200;
const SIDEBAR_MAX_EXPANDED_WIDTH = 600;
const BOARD_SURFACE_HORIZONTAL_CHROME_PX = 40;

const PROJECTS: RuntimeProjectSummary[] = [
	{
		id: "project-1",
		name: "Kanban",
		path: "/tmp/kanban",
		taskCounts: {
			backlog: 0,
			in_progress: 0,
			review: 0,
			trash: 0,
		},
	},
];

const CLINE_OAUTH_SETTINGS: RuntimeClineProviderSettings = {
	providerId: null,
	modelId: "cline-sonnet",
	baseUrl: null,
	reasoningEffort: null,
	apiKeyConfigured: false,
	oauthProvider: "cline",
	oauthAccessTokenConfigured: true,
	oauthRefreshTokenConfigured: true,
	oauthAccountId: "acc-1",
	oauthExpiresAt: 1_800_000_000_000,
};

function getSidebar(container: HTMLElement): HTMLElement {
	const sidebar = container.querySelector("aside");
	if (!sidebar) {
		throw new Error("Sidebar was not rendered");
	}
	return sidebar;
}

function getResizeHandle(container: HTMLElement): HTMLElement {
	const handle = container.querySelector('[aria-label="Resize sidebar"]');
	if (!handle) {
		throw new Error("Resize handle was not rendered");
	}
	return handle as HTMLElement;
}

describe("ProjectNavigationPanel width persistence", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;
	let previousAppVersion: unknown;
	let previousInnerWidth: number;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		previousAppVersion = (globalThis as typeof globalThis & { __APP_VERSION__?: unknown }).__APP_VERSION__;
		(globalThis as typeof globalThis & { __APP_VERSION__?: string }).__APP_VERSION__ = "test";
		previousInnerWidth = window.innerWidth;
		Object.defineProperty(window, "innerWidth", {
			value: 1600,
			configurable: true,
			writable: true,
		});
		localStorage.clear();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		localStorage.clear();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
		if (typeof previousAppVersion === "undefined") {
			delete (globalThis as typeof globalThis & { __APP_VERSION__?: unknown }).__APP_VERSION__;
		} else {
			(globalThis as typeof globalThis & { __APP_VERSION__?: unknown }).__APP_VERSION__ = previousAppVersion;
		}
		Object.defineProperty(window, "innerWidth", {
			value: previousInnerWidth,
			configurable: true,
			writable: true,
		});
	});

	function renderPanel(overrides: Partial<ComponentProps<typeof ProjectNavigationPanel>> = {}): void {
		act(() => {
			root.render(
				<ProjectNavigationPanel
					projects={PROJECTS}
					currentProjectId="project-1"
					removingProjectId={null}
					activeSection="projects"
					onActiveSectionChange={() => {}}
					canShowAgentSection
					selectedAgentId={null}
					clineProviderSettings={null}
					featurebaseFeedbackState={undefined}
					onSelectProject={() => {}}
					onRemoveProject={async () => true}
					onAddProject={() => {}}
					{...overrides}
				/>,
			);
		});
	}

	function getExpectedDefaultWidthPx(viewportWidth: number): number {
		const proportionalWidth = Math.round((viewportWidth - BOARD_SURFACE_HORIZONTAL_CHROME_PX) / 5);
		return Math.max(SIDEBAR_MIN_EXPANDED_WIDTH, Math.min(SIDEBAR_MAX_EXPANDED_WIDTH, proportionalWidth));
	}

	function clampExpandedWidth(width: number): number {
		return Math.max(SIDEBAR_MIN_EXPANDED_WIDTH, Math.min(SIDEBAR_MAX_EXPANDED_WIDTH, width));
	}

	it("uses a proportional one-fifth default width when no value is persisted", () => {
		renderPanel();
		const sidebar = getSidebar(container);
		expect(sidebar.style.width).toBe(`${getExpectedDefaultWidthPx(window.innerWidth)}px`);
	});

	it("persists resized width and restores it on remount", () => {
		renderPanel();
		const initialWidth = getExpectedDefaultWidthPx(window.innerWidth);
		const expectedResizedWidth = clampExpandedWidth(initialWidth + 160);
		const resizeHandle = getResizeHandle(container);
		act(() => {
			resizeHandle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 300 }));
		});
		act(() => {
			window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 460 }));
		});
		act(() => {
			window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
		});

		expect(localStorage.getItem(LocalStorageKey.ProjectNavigationPanelWidth)).toBe(String(expectedResizedWidth));

		act(() => {
			root.unmount();
		});
		root = createRoot(container);

		renderPanel();
		const sidebar = getSidebar(container);
		expect(sidebar.style.width).toBe(`${expectedResizedWidth}px`);
	});

	it("renders beta hint card with report issue in the projects view", () => {
		renderPanel();
		expect(container.textContent).toContain("Kanban is in beta. Help us improve by sharing your experience.");
		expect(container.textContent).toContain("Report issue");
	});

	it("shows send feedback instead of report issue when Cline OAuth is available", () => {
		renderPanel({
			selectedAgentId: "cline",
			clineProviderSettings: CLINE_OAUTH_SETTINGS,
			featurebaseFeedbackState: {
				authState: "ready",
				widgetOpenCount: 0,
				openFeedbackWidget: vi.fn(async () => {}),
			},
		});
		expect(container.textContent).toContain("Kanban is in beta. Help us improve by sharing your experience.");
		expect(container.textContent).toContain("Send feedback");
		expect(container.textContent).not.toContain("Report issue");
	});
});
