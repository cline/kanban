import type {
	ChatSessionState,
	ChatSlashCommand,
	ChatTimelineEntry,
} from "@/kanban/chat/types";

const mockCommands: ChatSlashCommand[] = [
	{ name: "web", description: "Search the web for information", input: { hint: "query to search for" } },
	{ name: "test", description: "Run tests for the current project" },
	{ name: "plan", description: "Create a detailed implementation plan", input: { hint: "what to plan" } },
	{ name: "review", description: "Review code changes" },
];

const baseTimestamp = Date.now() - 120_000; // 2 minutes ago

const mockTimeline: ChatTimelineEntry[] = [
	{
		type: "user_message",
		id: "msg-1",
		timestamp: baseTimestamp,
		text: "Can you analyze the authentication module and fix the token expiration bug?",
	},
	{
		type: "agent_thought",
		id: "thought-1",
		timestamp: baseTimestamp + 1_000,
		text: "Let me analyze the authentication module. The user is reporting a token expiration bug, so I should:\n1. Look at the token generation and validation code\n2. Check the expiration logic\n3. Identify where the bug might be\n\nI'll start by reading the main auth files and searching for expiration-related code.",
		isStreaming: false,
	},
	{
		type: "plan",
		id: "plan-1",
		timestamp: baseTimestamp + 2_000,
		entries: [
			{ content: "Read authentication module source files", status: "completed", priority: "high" },
			{ content: "Search for token expiration logic", status: "completed", priority: "high" },
			{ content: "Identify and fix the expiration bug", status: "in_progress", priority: "high" },
			{ content: "Add unit tests for the fix", status: "pending", priority: "medium" },
		],
	},
	{
		type: "tool_call",
		id: "tool-1",
		timestamp: baseTimestamp + 3_000,
		toolCall: {
			toolCallId: "tc-001",
			title: "Reading src/auth/token.ts",
			kind: "read",
			status: "completed",
			locations: [{ path: "src/auth/token.ts" }],
		},
	},
	{
		type: "tool_call",
		id: "tool-2",
		timestamp: baseTimestamp + 5_000,
		toolCall: {
			toolCallId: "tc-002",
			title: "Searching for \"tokenExpiry\"",
			kind: "search",
			status: "completed",
			content: [
				{
					type: "content",
					content: { type: "text", text: "Found 3 matches in 2 files" },
				},
			],
		},
	},
	{
		type: "agent_message",
		id: "msg-2",
		timestamp: baseTimestamp + 8_000,
		text: "I found the issue. In `src/auth/token.ts`, the token expiration is set using `Date.now()` which returns milliseconds, but the JWT library expects seconds.\n\nHere's the problematic code:\n\n```typescript\nconst expiresAt = Date.now() + TOKEN_LIFETIME;\n```\n\nThis should be:\n\n```typescript\nconst expiresAt = Math.floor(Date.now() / 1000) + TOKEN_LIFETIME;\n```\n\nI'll fix this now.",
		isStreaming: false,
	},
	{
		type: "permission_request",
		id: "perm-1",
		timestamp: baseTimestamp + 10_000,
		request: {
			toolCallId: "tc-003",
			toolCallTitle: "Edit src/auth/token.ts",
			options: [
				{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
				{ optionId: "allow-always", name: "Allow always", kind: "allow_always" },
				{ optionId: "reject", name: "Reject", kind: "reject_once" },
			],
		},
		resolved: true,
		selectedOptionId: "allow-once",
	},
	{
		type: "tool_call",
		id: "tool-3",
		timestamp: baseTimestamp + 12_000,
		toolCall: {
			toolCallId: "tc-003",
			title: "Editing src/auth/token.ts",
			kind: "edit",
			status: "completed",
			locations: [{ path: "src/auth/token.ts", line: 42 }],
			content: [
				{
					type: "diff",
					path: "src/auth/token.ts",
					oldText: "const expiresAt = Date.now() + TOKEN_LIFETIME;",
					newText: "const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_LIFETIME;",
				},
			],
		},
	},
	{
		type: "agent_message",
		id: "msg-3",
		timestamp: baseTimestamp + 15_000,
		text: "Done! I've fixed the token expiration bug. The issue was that `Date.now()` returns milliseconds but the JWT `exp` claim expects Unix timestamps in seconds.\n\nThe fix divides `Date.now()` by 1000 and floors the result before adding the lifetime duration. This ensures tokens expire at the correct time instead of thousands of years in the future.",
		isStreaming: false,
	},
];

export function createMockSession(): ChatSessionState {
	return {
		sessionId: "mock-session-1",
		status: "idle",
		timeline: [...mockTimeline],
		availableCommands: [...mockCommands],
	};
}

// Simulates an ACP agent response flow.
// Returns a cleanup function to cancel pending timeouts.
// When ACP is wired up, this is replaced by the real sessionUpdate handler.
export function simulateAgentResponse(
	userText: string,
	dispatch: (entry: ChatTimelineEntry) => void,
	setStatus: (status: ChatSessionState["status"]) => void,
): () => void {
	const timeouts: ReturnType<typeof setTimeout>[] = [];

	function schedule(ms: number, fn: () => void) {
		timeouts.push(setTimeout(fn, ms));
	}

	const now = Date.now();
	const thoughtId = `thought-${now}`;
	const messageId = `msg-${now}`;

	// Start thinking
	setStatus("thinking");

	// Thought block starts streaming
	schedule(300, () => {
		dispatch({
			type: "agent_thought",
			id: thoughtId,
			timestamp: Date.now(),
			text: `Analyzing the user's request: "${userText}"\n\nLet me think about the best approach...`,
			isStreaming: true,
		});
	});

	// Thought block finishes
	schedule(1200, () => {
		dispatch({
			type: "agent_thought",
			id: thoughtId,
			timestamp: Date.now(),
			text: `Analyzing the user's request: "${userText}"\n\nLet me think about the best approach. I'll need to examine the relevant code and determine the right course of action.`,
			isStreaming: false,
		});
	});

	// Tool call starts
	schedule(1600, () => {
		setStatus("tool_running");
		dispatch({
			type: "tool_call",
			id: `tool-${now}`,
			timestamp: Date.now(),
			toolCall: {
				toolCallId: `tc-${now}`,
				title: "Searching codebase",
				kind: "search",
				status: "in_progress",
			},
		});
	});

	// Tool call completes
	schedule(2400, () => {
		dispatch({
			type: "tool_call",
			id: `tool-${now}`,
			timestamp: Date.now(),
			toolCall: {
				toolCallId: `tc-${now}`,
				title: "Searching codebase",
				kind: "search",
				status: "completed",
				content: [
					{ type: "content", content: { type: "text", text: "Found relevant files" } },
				],
			},
		});
	});

	// Agent message starts streaming
	schedule(2800, () => {
		setStatus("thinking");
		dispatch({
			type: "agent_message",
			id: messageId,
			timestamp: Date.now(),
			text: "I've analyzed your request",
			isStreaming: true,
		});
	});

	// Agent message grows
	schedule(3200, () => {
		dispatch({
			type: "agent_message",
			id: messageId,
			timestamp: Date.now(),
			text: "I've analyzed your request and found the relevant code. Let me walk you through what I found and the changes I'd recommend.",
			isStreaming: true,
		});
	});

	// Agent message completes
	schedule(3800, () => {
		dispatch({
			type: "agent_message",
			id: messageId,
			timestamp: Date.now(),
			text: "I've analyzed your request and found the relevant code. Let me walk you through what I found and the changes I'd recommend.\n\nThe key issue is in the main module. I can make the necessary changes if you'd like me to proceed.",
			isStreaming: false,
		});
		setStatus("idle");
	});

	return () => {
		for (const t of timeouts) {
			clearTimeout(t);
		}
	};
}
