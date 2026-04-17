import { act, createRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClineAgentChatPanel, type ClineAgentChatPanelHandle } from "@/components/detail-panels/cline-agent-chat-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ClineChatMessage } from "@/hooks/use-cline-chat-session";
import type { RuntimeTaskHookActivity, RuntimeTaskSessionSummary } from "@/runtime/types";
import { resetWorkspaceMetadataStore, setTaskWorkspaceSnapshot } from "@/stores/workspace-metadata-store";

function createSummary(
	state: RuntimeTaskSessionSummary["state"],
	latestHookActivity: RuntimeTaskHookActivity | null = null,
	overrides: Partial<RuntimeTaskSessionSummary> = {},
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
		...overrides,
	};
}

function renderPanel(root: Root, panel: ReactElement): void {
	root.render(<TooltipProvider>{panel}</TooltipProvider>);
}

function getMessageList(container: HTMLElement): HTMLDivElement {
	const messageList = container.querySelector("div.overflow-y-auto");
	expect(messageList).toBeInstanceOf(HTMLDivElement);
	if (!(messageList instanceof HTMLDivElement)) {
		throw new Error("Expected chat message list.");
	}
	return messageList;
}

function mockScrollMetrics(
	element: HTMLDivElement,
	initialValues: { scrollHeight: number; clientHeight: number; scrollTop: number },
): {
	getScrollTop: () => number;
	setScrollHeight: (value: number) => void;
	setScrollTop: (value: number) => void;
} {
	let currentScrollHeight = initialValues.scrollHeight;
	const currentClientHeight = initialValues.clientHeight;
	let currentScrollTop = initialValues.scrollTop;

	Object.defineProperty(element, "scrollHeight", {
		configurable: true,
		get: () => currentScrollHeight,
	});
	Object.defineProperty(element, "clientHeight", {
		configurable: true,
		get: () => currentClientHeight,
	});
	Object.defineProperty(element, "scrollTop", {
		configurable: true,
		get: () => currentScrollTop,
		set: (value: number) => {
			currentScrollTop = value;
		},
	});

	return {
		getScrollTop: () => currentScrollTop,
		setScrollHeight: (value: number) => {
			currentScrollHeight = value;
		},
		setScrollTop: (value: number) => {
			currentScrollTop = value;
		},
	};
}

describe("ClineAgentChatPanel", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		resetWorkspaceMetadataStore();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		act(() => {
			root.unmount();
		});
		resetWorkspaceMetadataStore();
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
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
			renderPanel(
				root,
				<ClineAgentChatPanel taskId="task-1" summary={null} onLoadMessages={async () => messages} />,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Reasoning");
		expect(container.textContent).not.toContain("Thinking through the next edit");

		const reasoningToggle = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Reasoning"),
		);
		expect(reasoningToggle).toBeInstanceOf(HTMLButtonElement);
		if (!(reasoningToggle instanceof HTMLButtonElement)) {
			throw new Error("Expected reasoning toggle button");
		}
		await act(async () => {
			reasoningToggle.click();
		});

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

	it("keeps completed reasoning collapsed after the stream finishes", async () => {
		const onLoadMessages = vi.fn(async () => []);
		const streamingReasoningMessage: ClineChatMessage = {
			id: "reasoning-1",
			role: "reasoning",
			content: "Thinking through the next edit",
			createdAt: 1,
			meta: {
				hookEventName: "reasoning_delta",
				streamType: "reasoning",
			},
		};
		const completedReasoningMessage: ClineChatMessage = {
			...streamingReasoningMessage,
			meta: {
				hookEventName: "reasoning_end",
				streamType: "reasoning",
			},
		};

		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					taskId="task-1"
					summary={createSummary("running")}
					onLoadMessages={onLoadMessages}
					incomingMessage={streamingReasoningMessage}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Thinking through the next edit");

		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					taskId="task-1"
					summary={createSummary("running")}
					onLoadMessages={onLoadMessages}
					incomingMessage={completedReasoningMessage}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).not.toContain("Thinking through the next edit");

		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					taskId="task-1"
					summary={createSummary("awaiting_review")}
					onLoadMessages={onLoadMessages}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).not.toContain("Thinking through the next edit");
	});

	it("shows running progress indicator while session is running", async () => {
		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel taskId="task-1" summary={createSummary("running")} onLoadMessages={async () => []} />,
			);
			await Promise.resolve();
		});

		const thinkingSpinner = container.querySelector('[data-testid="cline-thinking-spinner"]');
		expect(thinkingSpinner?.textContent).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u);
		expect(container.textContent).toContain("Thinking...");
		expect(container.textContent).not.toContain("Cline chat");
	});

	it("shows a compact warning below the composer when the session has a warning", async () => {
		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					taskId="task-1"
					summary={{
						...createSummary("running"),
						warningMessage:
							'Failed to load MCP server "linear": MCP server "linear" requires OAuth authorization.',
					}}
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain('Failed to load MCP server "linear"');
	});

	it("renders a chat-level out-of-credits notice when credit-limit metadata is present", async () => {
		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					taskId="task-1"
					summary={createSummary(
						"awaiting_review",
						{
							activityText: "Agent error: 402 Insufficient balance",
							toolName: null,
							toolInputSummary: null,
							finalMessage: "402 Insufficient balance. Your Cline Credits balance is $0.00",
							hookEventName: "agent_error",
							notificationType: "credit_limit",
							source: "cline-sdk",
						},
						{ reviewReason: "error" },
					)}
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});

		await vi.waitFor(() => {
			const buyCreditsLink = container.querySelector('a[href="https://app.cline.bot/"]');
			expect(buyCreditsLink).toBeInstanceOf(HTMLAnchorElement);
		});
		expect(container.textContent).toContain("Out of Cline credits.");
	});

	it("shows out-of-credits notice after interrupted state when credit-limit metadata persists", async () => {
		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					taskId="task-1"
					summary={createSummary(
						"interrupted",
						{
							activityText: "Agent error: 402 Insufficient balance",
							toolName: null,
							toolInputSummary: null,
							finalMessage: "402 Insufficient balance. Your Cline Credits balance is $0.00",
							hookEventName: "agent_end",
							notificationType: "credit_limit",
							source: "cline-sdk",
						},
						{ reviewReason: "interrupted" },
					)}
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});

		await vi.waitFor(() => {
			const buyCreditsLink = container.querySelector('a[href="https://app.cline.bot/"]');
			expect(buyCreditsLink).toBeInstanceOf(HTMLAnchorElement);
		});
	});

	it("renders user message images inline without a task header", async () => {
		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					taskId="task-1"
					summary={createSummary("running")}
					onLoadMessages={async () => [
						{
							id: "msg-1",
							role: "user",
							content: "Please inspect this screenshot",
							images: [
								{
									id: "img-1",
									data: "abc123",
									mimeType: "image/png",
									name: "error.png",
								},
							],
							createdAt: 1,
						},
					]}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Please inspect this screenshot");
		expect(container.textContent).toContain("error.png");
		expect(container.textContent).not.toContain("Task images");
		const image = container.querySelector('img[alt="error.png"]');
		expect(image).toBeInstanceOf(HTMLImageElement);
	});

	it("keeps the message list pinned to the bottom while new content streams in", async () => {
		const initialMessages: ClineChatMessage[] = [
			{
				id: "assistant-1",
				role: "assistant",
				content: "First reply",
				createdAt: 1,
			},
		];
		const incomingMessage: ClineChatMessage = {
			id: "assistant-2",
			role: "assistant",
			content: "Second reply",
			createdAt: 2,
		};

		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel taskId="task-1" summary={null} onLoadMessages={async () => initialMessages} />,
			);
			await Promise.resolve();
		});

		const messageList = getMessageList(container);
		const scroll = mockScrollMetrics(messageList, {
			scrollHeight: 200,
			clientHeight: 100,
			scrollTop: 100,
		});
		scroll.setScrollHeight(260);

		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					taskId="task-1"
					summary={null}
					onLoadMessages={async () => initialMessages}
					incomingMessage={incomingMessage}
				/>,
			);
			await Promise.resolve();
		});

		expect(scroll.getScrollTop()).toBe(260);
	});

	it("stops auto-scroll while the user is reading older messages and re-enables it at the bottom", async () => {
		const initialMessages: ClineChatMessage[] = [
			{
				id: "assistant-1",
				role: "assistant",
				content: "First reply",
				createdAt: 1,
			},
		];
		const secondMessage: ClineChatMessage = {
			id: "assistant-2",
			role: "assistant",
			content: "Second reply",
			createdAt: 2,
		};
		const thirdMessage: ClineChatMessage = {
			id: "assistant-3",
			role: "assistant",
			content: "Third reply",
			createdAt: 3,
		};

		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel taskId="task-1" summary={null} onLoadMessages={async () => initialMessages} />,
			);
			await Promise.resolve();
		});

		const messageList = getMessageList(container);
		const scroll = mockScrollMetrics(messageList, {
			scrollHeight: 200,
			clientHeight: 100,
			scrollTop: 100,
		});

		scroll.setScrollTop(20);
		await act(async () => {
			messageList.dispatchEvent(new Event("scroll", { bubbles: true }));
			await Promise.resolve();
		});

		scroll.setScrollHeight(260);
		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					taskId="task-1"
					summary={null}
					onLoadMessages={async () => initialMessages}
					incomingMessage={secondMessage}
				/>,
			);
			await Promise.resolve();
		});

		expect(scroll.getScrollTop()).toBe(20);

		scroll.setScrollTop(160);
		await act(async () => {
			messageList.dispatchEvent(new Event("scroll", { bubbles: true }));
			await Promise.resolve();
		});

		scroll.setScrollHeight(320);
		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					taskId="task-1"
					summary={null}
					onLoadMessages={async () => initialMessages}
					incomingMessage={thirdMessage}
				/>,
			);
			await Promise.resolve();
		});

		expect(scroll.getScrollTop()).toBe(320);
	});

	it("shows the thinking indicator while assistant text is streaming", async () => {
		const messages: ClineChatMessage[] = [
			{
				id: "assistant-1",
				role: "assistant",
				content: "Streaming reply",
				createdAt: 1,
			},
		];

		await act(async () => {
			renderPanel(
				root,
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
		expect(container.textContent).toContain("Thinking...");
	});

	it("shows the thinking indicator while a tool call is streaming", async () => {
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
			renderPanel(
				root,
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
		expect(container.textContent).toContain("Thinking...");
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
			renderPanel(
				root,
				<ClineAgentChatPanel taskId="task-1" summary={null} onLoadMessages={async () => messages} />,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Here is code:");
		expect(container.textContent).toContain("const value = 1;");
		expect(container.querySelector("pre code")).toBeTruthy();
	});

	it("applies wrapping styles to inline code in assistant markdown", async () => {
		const messages: ClineChatMessage[] = [
			{
				id: "assistant-1",
				role: "assistant",
				content: "Use `averylongidentifierwithnobreakpointswhatsoever1234567890` here.",
				createdAt: 1,
			},
		];

		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel taskId="task-1" summary={null} onLoadMessages={async () => messages} />,
			);
			await Promise.resolve();
		});

		const inlineCode = container.querySelector("p code");
		expect(inlineCode).toBeInstanceOf(HTMLElement);
		expect(inlineCode?.className).toContain("whitespace-pre-wrap");
		expect(inlineCode?.className).toContain("break-all");
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
			renderPanel(
				root,
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
		expect(container.textContent).toContain("Select model");
		const sendButton = container.querySelector('button[aria-label="Cancel request"]');
		expect(sendButton).toBeInstanceOf(HTMLButtonElement);
		if (!(sendButton instanceof HTMLButtonElement)) {
			throw new Error("Expected composer action button");
		}
		expect(sendButton.disabled).toBe(false);

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
		expect(sendButton.disabled).toBe(false);

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

		expect(onSendMessage).toHaveBeenCalledWith("task-1", "Ship it", { mode: "act" });

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

	it("defaults the composer mode from the task and sends using the selected mode", async () => {
		const onSendMessage = vi.fn(async () => ({
			ok: true,
			chatMessage: {
				id: "sent-2",
				role: "user" as const,
				content: "Investigate",
				createdAt: 2,
			},
		}));

		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					taskId="task-1"
					summary={createSummary("idle")}
					defaultMode="plan"
					onLoadMessages={async () => []}
					onSendMessage={onSendMessage}
				/>,
			);
			await Promise.resolve();
		});

		const textarea = container.querySelector("textarea");
		expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
		if (!(textarea instanceof HTMLTextAreaElement)) {
			throw new Error("Expected composer textarea");
		}

		const planToggle = Array.from(container.querySelectorAll('button[role="tab"]')).find((button) =>
			button.textContent?.includes("Plan"),
		);
		expect(planToggle?.getAttribute("aria-selected")).toBe("true");

		await act(async () => {
			const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
			if (!valueSetter) {
				throw new Error("Expected textarea value setter");
			}
			valueSetter.call(textarea, "Investigate");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
			await Promise.resolve();
		});

		const sendButton = container.querySelector('button[aria-label="Send message"]');
		expect(sendButton).toBeInstanceOf(HTMLButtonElement);
		if (!(sendButton instanceof HTMLButtonElement)) {
			throw new Error("Expected composer send button");
		}

		await act(async () => {
			sendButton.click();
			await Promise.resolve();
		});

		expect(onSendMessage).toHaveBeenCalledWith("task-1", "Investigate", { mode: "plan" });
	});

	it("restores the previously selected mode when switching back to a task", async () => {
		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					taskId="task-1"
					summary={createSummary("idle")}
					defaultMode="act"
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});

		const planButton = Array.from(container.querySelectorAll('button[role="tab"]')).find((button) =>
			button.textContent?.includes("Plan"),
		);
		expect(planButton).toBeInstanceOf(HTMLButtonElement);
		if (!(planButton instanceof HTMLButtonElement)) {
			throw new Error("Expected plan mode toggle");
		}

		await act(async () => {
			planButton.click();
			await Promise.resolve();
		});
		expect(planButton.getAttribute("aria-selected")).toBe("true");

		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					taskId="task-2"
					summary={createSummary("idle", null, { taskId: "task-2" })}
					defaultMode="act"
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});

		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					taskId="task-1"
					summary={createSummary("idle")}
					defaultMode="act"
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});

		const restoredPlanButton = Array.from(container.querySelectorAll('button[role="tab"]')).find((button) =>
			button.textContent?.includes("Plan"),
		);
		expect(restoredPlanButton?.getAttribute("aria-selected")).toBe("true");
	});

	it("appends review comments into the composer draft through the panel handle", async () => {
		const panelRef = createRef<ClineAgentChatPanelHandle>();

		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					ref={panelRef}
					taskId="task-1"
					summary={createSummary("idle")}
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});

		const textarea = container.querySelector("textarea");
		expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
		if (!(textarea instanceof HTMLTextAreaElement)) {
			throw new Error("Expected composer textarea");
		}

		await act(async () => {
			const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
			if (!valueSetter) {
				throw new Error("Expected textarea value setter");
			}
			valueSetter.call(textarea, "Keep this");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
			await Promise.resolve();
		});

		await act(async () => {
			panelRef.current?.appendToDraft("src/example.ts:4 | value\n> Add tests");
			await Promise.resolve();
		});

		expect(textarea.value).toBe("Keep this\n\nsrc/example.ts:4 | value\n> Add tests");
	});

	it("sends review comments through the panel handle without overwriting the draft", async () => {
		const panelRef = createRef<ClineAgentChatPanelHandle>();
		const onSendMessage = vi.fn(async () => ({
			ok: true,
			chatMessage: {
				id: "sent-review-comments",
				role: "user" as const,
				content: "src/example.ts:8 | done\n> Ship this",
				createdAt: 2,
			},
		}));

		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					ref={panelRef}
					taskId="task-1"
					summary={createSummary("idle")}
					onLoadMessages={async () => []}
					onSendMessage={onSendMessage}
				/>,
			);
			await Promise.resolve();
		});

		const textarea = container.querySelector("textarea");
		expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
		if (!(textarea instanceof HTMLTextAreaElement)) {
			throw new Error("Expected composer textarea");
		}

		await act(async () => {
			const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
			if (!valueSetter) {
				throw new Error("Expected textarea value setter");
			}
			valueSetter.call(textarea, "Keep acting");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
			await Promise.resolve();
		});

		await act(async () => {
			await panelRef.current?.sendText("src/example.ts:8 | done\n> Ship this");
		});

		expect(onSendMessage).toHaveBeenCalledWith("task-1", "src/example.ts:8 | done\n> Ship this", { mode: "act" });
		expect(textarea.value).toBe("Keep acting");
	});

	it("toggles the composer mode with command shift a", async () => {
		const onSendMessage = vi.fn(async () => ({
			ok: true,
			chatMessage: {
				id: "sent-3",
				role: "user" as const,
				content: "Switch it",
				createdAt: 2,
			},
		}));

		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					taskId="task-1"
					summary={createSummary("idle")}
					onLoadMessages={async () => []}
					onSendMessage={onSendMessage}
				/>,
			);
			await Promise.resolve();
		});

		const textarea = container.querySelector("textarea");
		expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
		if (!(textarea instanceof HTMLTextAreaElement)) {
			throw new Error("Expected composer textarea");
		}

		await act(async () => {
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "A",
					metaKey: true,
					shiftKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
			await Promise.resolve();
		});

		await act(async () => {
			const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
			if (!valueSetter) {
				throw new Error("Expected textarea value setter");
			}
			valueSetter.call(textarea, "Switch it");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
			await Promise.resolve();
		});

		const sendButton = container.querySelector('button[aria-label="Send message"]');
		expect(sendButton).toBeInstanceOf(HTMLButtonElement);
		if (!(sendButton instanceof HTMLButtonElement)) {
			throw new Error("Expected composer send button");
		}

		await act(async () => {
			sendButton.click();
			await Promise.resolve();
		});

		expect(onSendMessage).toHaveBeenCalledWith("task-1", "Switch it", { mode: "plan" });
	});

	it("hides the composer mode toggle when requested", async () => {
		const onSendMessage = vi.fn(async () => ({
			ok: true,
			chatMessage: {
				id: "sent-4",
				role: "user" as const,
				content: "Keep acting",
				createdAt: 2,
			},
		}));

		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					taskId="task-1"
					summary={createSummary("idle")}
					showComposerModeToggle={false}
					onLoadMessages={async () => []}
					onSendMessage={onSendMessage}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.querySelector('[aria-label="Cline mode"]')).toBeNull();

		const textarea = container.querySelector("textarea");
		expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
		if (!(textarea instanceof HTMLTextAreaElement)) {
			throw new Error("Expected composer textarea");
		}

		await act(async () => {
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "A",
					metaKey: true,
					shiftKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
			await Promise.resolve();
		});

		await act(async () => {
			const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
			if (!valueSetter) {
				throw new Error("Expected textarea value setter");
			}
			valueSetter.call(textarea, "Keep acting");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
			await Promise.resolve();
		});

		const sendButton = container.querySelector('button[aria-label="Send message"]');
		expect(sendButton).toBeInstanceOf(HTMLButtonElement);
		if (!(sendButton instanceof HTMLButtonElement)) {
			throw new Error("Expected composer send button");
		}

		await act(async () => {
			sendButton.click();
			await Promise.resolve();
		});

		expect(onSendMessage).toHaveBeenCalledWith("task-1", "Keep acting", { mode: "act" });
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
		setTaskWorkspaceSnapshot({
			taskId: "task-1",
			path: "/tmp/worktree",
			branch: "task-1",
			isDetached: false,
			headCommit: "abc1234",
			changedFiles: 2,
			additions: 3,
			deletions: 1,
		});

		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					taskId="task-1"
					summary={createSummary("awaiting_review")}
					onLoadMessages={async () => messages}
					showMoveToTrash={false}
				/>,
			);
			await Promise.resolve();
		});

		const messageList = getMessageList(container);
		const scroll = mockScrollMetrics(messageList, {
			scrollHeight: 200,
			clientHeight: 100,
			scrollTop: 100,
		});
		scroll.setScrollHeight(240);

		await act(async () => {
			renderPanel(
				root,
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

		expect(scroll.getScrollTop()).toBe(240);
	});

	it("does not show commit actions when the review workspace is clean", async () => {
		setTaskWorkspaceSnapshot({
			taskId: "task-1",
			path: "/tmp/worktree",
			branch: "task-1",
			isDetached: false,
			headCommit: "def5678",
			changedFiles: 0,
			additions: 0,
			deletions: 0,
		});

		await act(async () => {
			renderPanel(
				root,
				<ClineAgentChatPanel
					taskId="task-1"
					summary={createSummary("awaiting_review")}
					onLoadMessages={async () => []}
					taskColumnId="review"
					onCommit={() => {}}
					onOpenPr={() => {}}
					onMoveToTrash={() => {}}
					showMoveToTrash
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).not.toContain("Commit");
		expect(container.textContent).not.toContain("Open PR");
		expect(container.textContent).toContain("Move Card To Trash");
	});
});
