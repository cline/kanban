import { act, type ReactElement, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskCreateDialog } from "@/components/task-create-dialog";
import type { RuntimeAgentId } from "@/runtime/types";
import type { TaskAutoReviewMode } from "@/types";

const searchFilesQueryMock = vi.hoisted(() => vi.fn());
const readFileQueryMock = vi.hoisted(() => vi.fn());

vi.mock("react-hotkeys-hook", () => ({
	useHotkeys: () => {},
}));

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		workspace: {
			searchFiles: {
				query: searchFilesQueryMock,
			},
			readFile: {
				query: readFileQueryMock,
			},
		},
	}),
}));

vi.mock("@/components/task-prompt-composer", () => ({
	TaskPromptComposer: ({ value, onValueChange, placeholder }: { value: string; onValueChange: (value: string) => void; placeholder?: string }) => (
		<textarea
			data-testid="task-prompt-composer"
			value={value}
			placeholder={placeholder}
			onChange={(event) => onValueChange(event.target.value)}
		/>
	),
}));

vi.mock("@/components/branch-select-dropdown", () => ({
	BranchSelectDropdown: ({ selectedValue, onSelect }: { selectedValue: string; onSelect: (value: string) => void }) => (
		<select data-testid="branch-select" value={selectedValue} onChange={(event) => onSelect(event.target.value)}>
			<option value="main">main</option>
		</select>
	),
}));

vi.mock("@/components/ui/dialog", () => ({
	Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
	DialogHeader: ({ title }: { title: string }) => <div>{title}</div>,
	DialogBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function getButtonByText(container: HTMLElement, text: string): HTMLButtonElement {
	const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
		candidate.textContent?.includes(text),
	);
	if (!(button instanceof HTMLButtonElement)) {
		throw new Error(`Expected to find button containing text: ${text}`);
	}
	return button;
}

function getInputByPlaceholder(container: HTMLElement, placeholder: string): HTMLInputElement {
	const input = Array.from(container.querySelectorAll("input")).find(
		(candidate) => candidate.getAttribute("placeholder") === placeholder,
	);
	if (!(input instanceof HTMLInputElement)) {
		throw new Error(`Expected to find input with placeholder: ${placeholder}`);
	}
	return input;
}

async function flushPromises(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

function click(element: HTMLElement): void {
	element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function changeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
	const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
	const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
	valueSetter?.call(element, value);
	element.dispatchEvent(new Event("input", { bubbles: true }));
	element.dispatchEvent(new Event("change", { bubbles: true }));
}

function Harness({
	initialPrompt,
	onCreateMultiple,
}: {
	initialPrompt: string;
	onCreateMultiple: (prompts: string[]) => void;
}): ReactElement {
	const [prompt, setPrompt] = useState(initialPrompt);
	const [startInPlanMode, setStartInPlanMode] = useState(false);
	const [autoReviewEnabled, setAutoReviewEnabled] = useState(false);
	const [autoReviewMode, setAutoReviewMode] = useState<TaskAutoReviewMode>("commit");
	const [agentId, setAgentId] = useState<RuntimeAgentId | null>("codex");
	const [branchRef, setBranchRef] = useState("main");

	return (
		<TaskCreateDialog
			open
			onOpenChange={() => {}}
			prompt={prompt}
			onPromptChange={setPrompt}
			onCreate={() => {}}
			onCreateMultiple={onCreateMultiple}
			startInPlanMode={startInPlanMode}
			onStartInPlanModeChange={setStartInPlanMode}
			autoReviewEnabled={autoReviewEnabled}
			onAutoReviewEnabledChange={setAutoReviewEnabled}
			autoReviewMode={autoReviewMode}
			onAutoReviewModeChange={setAutoReviewMode}
			agentId={agentId}
			agentOptions={[{ value: "codex", label: "Codex", installed: true }]}
			onAgentIdChange={setAgentId}
			workspaceId="workspace-1"
			branchRef={branchRef}
			branchOptions={[{ value: "main", label: "main" }]}
			onBranchRefChange={setBranchRef}
		/>
	);
}

describe("TaskCreateDialog", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
		searchFilesQueryMock.mockReset();
		readFileQueryMock.mockReset();
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
		vi.useRealTimers();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("imports markdown prompts and creates tasks in source order", async () => {
		const onCreateMultiple = vi.fn();
		searchFilesQueryMock.mockResolvedValue({
			query: "strategy",
			files: [{ path: "docs/strategy.md", name: "strategy.md", changed: false }],
		});
		readFileQueryMock.mockResolvedValue({
			path: "docs/strategy.md",
			content: "# Strategy\n\n## Tasks\n1. First task\n2. Second task\n",
		});

		await act(async () => {
			root.render(<Harness initialPrompt="Original prompt" onCreateMultiple={onCreateMultiple} />);
		});

		await act(async () => {
			click(getButtonByText(container, "Import markdown"));
		});

		await act(async () => {
			changeValue(getInputByPlaceholder(container, "Search PRD / strategy files..."), "strategy");
		});

		await act(async () => {
			vi.advanceTimersByTime(120);
			await flushPromises();
		});

		expect(searchFilesQueryMock).toHaveBeenCalledWith({ query: "strategy", limit: 20 });

		await act(async () => {
			click(getButtonByText(container, "strategy.md"));
			await flushPromises();
		});

		expect(readFileQueryMock).toHaveBeenCalledWith({ path: "docs/strategy.md" });
		expect(container.textContent).toContain("Imported from docs/strategy.md");
		expect(container.textContent).toContain("Create 2 tasks");

		await act(async () => {
			click(getButtonByText(container, "Create 2 tasks"));
		});

		expect(onCreateMultiple).toHaveBeenCalledWith([
			"First task @docs/strategy.md",
			"Second task @docs/strategy.md",
		]);
	});

	it("restores the original single prompt when leaving imported multi-task mode", async () => {
		searchFilesQueryMock.mockResolvedValue({
			query: "strategy",
			files: [{ path: "docs/strategy.md", name: "strategy.md", changed: false }],
		});
		readFileQueryMock.mockResolvedValue({
			path: "docs/strategy.md",
			content: "## Tasks\n- First imported task\n",
		});

		await act(async () => {
			root.render(<Harness initialPrompt="Original prompt" onCreateMultiple={() => {}} />);
		});

		await act(async () => {
			click(getButtonByText(container, "Import markdown"));
		});

		await act(async () => {
			changeValue(getInputByPlaceholder(container, "Search PRD / strategy files..."), "strategy");
		});

		await act(async () => {
			vi.advanceTimersByTime(120);
			await flushPromises();
		});

		await act(async () => {
			click(getButtonByText(container, "strategy.md"));
			await flushPromises();
		});

		await act(async () => {
			click(getButtonByText(container, "Back to single prompt"));
		});

		const composer = container.querySelector('[data-testid="task-prompt-composer"]');
		if (!(composer instanceof HTMLTextAreaElement)) {
			throw new Error("Expected the prompt composer to be rendered.");
		}
		expect(composer.value).toBe("Original prompt");
	});
});
