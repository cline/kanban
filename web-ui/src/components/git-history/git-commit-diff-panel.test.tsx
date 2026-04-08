import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitCommitDiffPanel, type GitCommitDiffSource } from "@/components/git-history/git-commit-diff-panel";

vi.mock("@/resize/layout-customizations", () => ({
	useLayoutResetEffect: () => {},
}));

function createRect(top: number): DOMRect {
	return {
		x: 0,
		y: top,
		width: 600,
		height: 24,
		top,
		right: 600,
		bottom: top + 24,
		left: 0,
		toJSON: () => ({}),
	};
}

describe("GitCommitDiffPanel", () => {
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
		vi.restoreAllMocks();
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("scrolls to selected files using section position relative to the diff scroll container", async () => {
		const diffSource: GitCommitDiffSource = {
			type: "commit",
			files: [
				{
					path: "src/a.ts",
					status: "modified",
					additions: 1,
					deletions: 0,
					patch: "@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n",
				},
				{
					path: "src/b.ts",
					status: "modified",
					additions: 1,
					deletions: 0,
					patch: "@@ -1 +1 @@\n-const b = 1;\n+const b = 2;\n",
				},
			],
		};

		await act(async () => {
			root.render(
				<GitCommitDiffPanel
					diffSource={diffSource}
					isLoading={false}
					errorMessage={null}
					selectedPath={null}
					onSelectPath={() => {}}
					headerContent={<div style={{ height: 28 }}>Header</div>}
				/>,
			);
		});

		const sections = Array.from(container.querySelectorAll("section"));
		expect(sections).toHaveLength(2);

		const scrollContainer = sections[0]?.parentElement;
		expect(scrollContainer).toBeInstanceOf(HTMLDivElement);
		if (!(scrollContainer instanceof HTMLDivElement)) {
			throw new Error("Expected a diff scroll container.");
		}

		Object.defineProperty(scrollContainer, "scrollTop", {
			configurable: true,
			writable: true,
			value: 200,
		});
		Object.defineProperty(scrollContainer, "clientTop", {
			configurable: true,
			value: 1,
		});
		Object.defineProperty(sections[1]!, "offsetTop", {
			configurable: true,
			value: 700,
		});

		vi.spyOn(scrollContainer, "getBoundingClientRect").mockReturnValue(createRect(100));
		vi.spyOn(sections[0]!, "getBoundingClientRect").mockReturnValue(createRect(140));
		vi.spyOn(sections[1]!, "getBoundingClientRect").mockReturnValue(createRect(460));

		const originalGetComputedStyle = window.getComputedStyle.bind(window);
		vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element) => {
			if (element === scrollContainer) {
				return Object.assign({}, originalGetComputedStyle(element), { paddingTop: "12px" }) as CSSStyleDeclaration;
			}
			return originalGetComputedStyle(element);
		});

		await act(async () => {
			root.render(
				<GitCommitDiffPanel
					diffSource={diffSource}
					isLoading={false}
					errorMessage={null}
					selectedPath="src/b.ts"
					onSelectPath={() => {}}
					headerContent={<div style={{ height: 28 }}>Header</div>}
				/>,
			);
		});

		expect(scrollContainer.scrollTop).toBe(547);
	});

	it("shows only the file header for binary paths", async () => {
		const diffSource: GitCommitDiffSource = {
			type: "commit",
			files: [
				{
					path: "assets/logo.png",
					status: "modified",
					additions: 0,
					deletions: 0,
					patch: "Binary files a/assets/logo.png and b/assets/logo.png differ\n",
				},
			],
		};

		await act(async () => {
			root.render(
				<GitCommitDiffPanel
					diffSource={diffSource}
					isLoading={false}
					errorMessage={null}
					selectedPath={null}
					onSelectPath={() => {}}
				/>,
			);
		});

		expect(container.textContent).toContain("assets/logo.png");
		expect(container.textContent).toContain("Binary");
		expect(container.textContent).not.toContain("No textual diff available.");
		expect(container.querySelector(".kb-diff-row")).toBeNull();
	});
});
