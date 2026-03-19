import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClineAgentChatPanel } from "@/components/detail-panels/cline-agent-chat-panel";
import type { ClineChatMessage } from "@/hooks/use-cline-chat-session";
import type { RuntimeTaskHookActivity, RuntimeTaskSessionSummary } from "@/runtime/types";

function createSummary(
	state: RuntimeTaskSessionSummary["state"],
	latestHookActivity: RuntimeTaskHookActivity | null = null,
): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state,
		agentId: "cline",
		workspacePath: "/tmp/worktree",
		pid: null,
		startedAt: Date.now(),
		updatedAt: Date.now(),
		lastOutputAt: Date.now(),
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}

describe("ClineAgentChatPanel", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;
	let scrollIntoViewMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		scrollIntoViewMock = vi.fn();
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: scrollIntoViewMock,
		});
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
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: () => {},
		});
	});

	it("renders reasoning and tool messages with specialized UI", async () => {
		const messages: ClineChatMessage[] = [
			{
				id: "reasoning-1",
				role: "reasoning",
				content: "Thinking through the next edit",
				createdAt: 1,
			},
			{
				id: "tool-1",
				role: "tool",
				content: [
					"Tool: Read",
					"Input:",
					'{"file":"src/index.ts"}',
					"Output:",
					'{"ok":true}',
					"Duration: 21ms",
				].join("\n"),
				createdAt: 2,
				meta: {
					hookEventName: "tool_call_start",
					toolName: "Read",
					streamType: "tool",
				},
			},
		];

		await act(async () => {
			root.render(
				<ClineAgentChatPanel
					taskId="task-1"
					summary={null}
					onLoadMessages={async () => messages}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Reasoning");
		expect(container.textContent).toContain("Thinking through the next edit");
		expect(container.textContent).toContain("Read");
		expect(container.textContent).toContain("src/index.ts");
		expect(container.textContent).not.toContain("Input");
		expect(container.textContent).not.toContain("Output");
		expect(container.textContent).not.toContain("21ms");

		const toolToggle = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Read"),
		);
		expect(toolToggle).toBeInstanceOf(HTMLButtonElement);
		if (!(toolToggle instanceof HTMLButtonElement)) {
			throw new Error("Expected tool toggle button");
		}

		await act(async () => {
			toolToggle.click();
		});

		expect(container.textContent).toContain("Output");
		expect(container.textContent).toContain('{"ok":true}');
	});

	it("shows running progress indicator while session is running", async () => {
		await act(async () => {
			root.render(
				<ClineAgentChatPanel
					taskId="task-1"
					summary={createSummary("running")}
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Thinking...");
		expect(container.textContent).not.toContain("Cline chat");
		expect(scrollIntoViewMock).toHaveBeenCalled();
	});

	it("hides the thinking indicator while assistant text is streaming", async () => {
		const messages: ClineChatMessage[] = [
			{
				id: "assistant-1",
				role: "assistant",
				content: "Streaming reply",
				createdAt: 1,
			},
		];

		await act(async () => {
			root.render(
				<ClineAgentChatPanel
					taskId="task-1"
					summary={createSummary("running", {
						activityText: "Agent active",
						toolName: null,
						toolInputSummary: null,
						finalMessage: null,
						hookEventName: "assistant_delta",
						notificationType: null,
						source: "cline-sdk",
					})}
					onLoadMessages={async () => messages}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Streaming reply");
		expect(container.textContent).not.toContain("Thinking...");
	});

	it("hides the thinking indicator while a tool call is streaming", async () => {
		const messages: ClineChatMessage[] = [
			{
				id: "tool-1",
				role: "tool",
				content: ["Tool: Read", "Input:", '{"file":"src/index.ts"}'].join("\n"),
				createdAt: 1,
				meta: {
					hookEventName: "tool_call_start",
					toolName: "Read",
					streamType: "tool",
				},
			},
		];

		await act(async () => {
			root.render(
				<ClineAgentChatPanel
					taskId="task-1"
					summary={createSummary("running", {
						activityText: "Using Read",
						toolName: "Read",
						toolInputSummary: null,
						finalMessage: null,
						hookEventName: "tool_call",
						notificationType: null,
						source: "cline-sdk",
					})}
					onLoadMessages={async () => messages}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Read");
		expect(container.textContent).not.toContain("Thinking...");
	});

	it("renders assistant markdown including fenced code blocks", async () => {
		const messages: ClineChatMessage[] = [
			{
				id: "assistant-1",
				role: "assistant",
				content: "Here is code:\n```ts\nconst value = 1;\n```",
				createdAt: 1,
			},
		];

		await act(async () => {
			root.render(
				<ClineAgentChatPanel
					taskId="task-1"
					summary={null}
					onLoadMessages={async () => messages}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Here is code:");
		expect(container.textContent).toContain("const value = 1;");
		expect(container.querySelector("pre code")).toBeTruthy();
	});

	it("autofocuses the composer, grows it, sends on enter, and cancels on escape", async () => {
		const onSendMessage = vi.fn(async () => ({
			ok: true,
			chatMessage: {
				id: "sent-1",
				role: "user" as const,
				content: "Ship it",
				createdAt: 2,
			},
		}));
		const onCancelTurn = vi.fn(async () => ({ ok: true }));

		await act(async () => {
			root.render(
				<ClineAgentChatPanel
					taskId="task-1"
					summary={createSummary("running")}
					onLoadMessages={async () => []}
					onSendMessage={onSendMessage}
					onCancelTurn={onCancelTurn}
				/>,
			);
			await Promise.resolve();
		});

		const textarea = container.querySelector("textarea");
		expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
		if (!(textarea instanceof HTMLTextAreaElement)) {
			throw new Error("Expected composer textarea");
		}

		expect(document.activeElement).toBe(textarea);
		expect(textarea.getAttribute("rows")).toBe("1");
		expect(container.querySelectorAll("button")).toHaveLength(0);

		Object.defineProperty(textarea, "scrollHeight", {
			configurable: true,
			value: 96,
		});

		await act(async () => {
			const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
			if (!valueSetter) {
				throw new Error("Expected textarea value setter");
			}
			valueSetter.call(textarea, "Ship it");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
			await Promise.resolve();
		});

		expect(textarea.style.height).toBe("96px");

		await act(async () => {
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			);
			await Promise.resolve();
		});

		expect(onSendMessage).toHaveBeenCalledWith("task-1", "Ship it");

		await act(async () => {
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			);
			await Promise.resolve();
		});

		expect(onCancelTurn).toHaveBeenCalledWith("task-1");
	});

	it("keeps chat pinned to bottom when action footer appears", async () => {
		const messages: ClineChatMessage[] = [
			{
				id: "assistant-1",
				role: "assistant",
				content: "Done and ready for review.",
				createdAt: 1,
			},
		];

		await act(async () => {
			root.render(
				<ClineAgentChatPanel
					taskId="task-1"
					summary={createSummary("awaiting_review")}
					onLoadMessages={async () => messages}
					showMoveToTrash={false}
				/>,
			);
			await Promise.resolve();
		});

		scrollIntoViewMock.mockClear();

		await act(async () => {
			root.render(
				<ClineAgentChatPanel
					taskId="task-1"
					summary={createSummary("awaiting_review")}
					onLoadMessages={async () => messages}
					taskColumnId="review"
					onCommit={() => {}}
					onOpenPr={() => {}}
					onMoveToTrash={() => {}}
					showMoveToTrash
				/>,
			);
			await Promise.resolve();
		});

		expect(scrollIntoViewMock).toHaveBeenCalled();
	});
});
