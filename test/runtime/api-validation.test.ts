import { describe, expect, it } from "vitest";
import { runtimeBoardCardSchema } from "../../src/core/api-contract";
import {
	parseHookIngestRequest,
	parseTaskSessionStartRequest,
	parseWorkspaceFileSearchRequest,
} from "../../src/core/api-validation";

describe("parseWorkspaceFileSearchRequest", () => {
	it("parses q and limit", () => {
		const parsed = parseWorkspaceFileSearchRequest(new URLSearchParams({ q: "  src/runtime ", limit: "25" }));
		expect(parsed).toEqual({
			query: "src/runtime",
			limit: 25,
		});
	});

	it("treats missing q as empty query", () => {
		const parsed = parseWorkspaceFileSearchRequest(new URLSearchParams({ limit: "10" }));
		expect(parsed).toEqual({
			query: "",
		});
	});

	it("does not accept legacy query alias", () => {
		const parsed = parseWorkspaceFileSearchRequest(new URLSearchParams({ query: "legacy" }));
		expect(parsed).toEqual({
			query: "",
		});
	});

	it("throws when limit is invalid", () => {
		expect(() => {
			parseWorkspaceFileSearchRequest(new URLSearchParams({ q: "board", limit: "0" }));
		}).toThrow("Invalid file search limit parameter.");
	});
});

describe("parseHookIngestRequest", () => {
	it("parses and trims task and workspace identifiers", () => {
		const parsed = parseHookIngestRequest({
			taskId: "  task-123  ",
			workspaceId: "  workspace-456  ",
			event: "to_review",
			metadata: {
				source: " claude ",
				activityText: " Using Read ",
			},
		});
		expect(parsed).toEqual({
			taskId: "task-123",
			workspaceId: "workspace-456",
			event: "to_review",
			metadata: {
				source: "claude",
				activityText: "Using Read",
				hookEventName: undefined,
				toolName: undefined,
				finalMessage: undefined,
				notificationType: undefined,
			},
		});
	});

	it("throws when workspaceId is missing", () => {
		expect(() => {
			parseHookIngestRequest({
				taskId: "task-1",
				workspaceId: "   ",
				event: "to_review",
			});
		}).toThrow("Missing workspaceId");
	});
});

describe("parseTaskSessionStartRequest", () => {
	it("parses resumeFromTrash and trims task identifiers", () => {
		const parsed = parseTaskSessionStartRequest({
			taskId: "  task-1  ",
			prompt: "",
			baseRef: "  main  ",
			resumeFromTrash: true,
		});
		expect(parsed).toEqual({
			taskId: "task-1",
			prompt: "",
			baseRef: "main",
			resumeFromTrash: true,
		});
	});
});

describe("runtimeBoardCardSchema pendingGitAction", () => {
	const legacyCard = {
		id: "task-1",
		prompt: "Do the thing",
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 2,
	};

	it("parses legacy cards without pendingGitAction unchanged", () => {
		const parsed = runtimeBoardCardSchema.parse(legacyCard);
		expect(parsed.pendingGitAction).toBeUndefined();
		expect(parsed.id).toBe("task-1");
		expect(parsed.prompt).toBe("Do the thing");
	});

	it("parses null pendingGitAction", () => {
		const parsed = runtimeBoardCardSchema.parse({ ...legacyCard, pendingGitAction: null });
		expect(parsed.pendingGitAction).toBeNull();
	});

	it("parses a persisted pendingGitAction and defaults attempt to 0", () => {
		const parsed = runtimeBoardCardSchema.parse({
			...legacyCard,
			pendingGitAction: {
				action: "commit",
				requestedAt: 123,
				headCommitAtRequest: "abc123",
			},
		});
		expect(parsed.pendingGitAction).toEqual({
			action: "commit",
			requestedAt: 123,
			headCommitAtRequest: "abc123",
			attempt: 0,
		});
	});

	it("rejects an unknown pendingGitAction action", () => {
		expect(() =>
			runtimeBoardCardSchema.parse({
				...legacyCard,
				pendingGitAction: {
					action: "push",
					requestedAt: 123,
					headCommitAtRequest: null,
				},
			}),
		).toThrow();
	});
});
