import { describe, expect, it } from "vitest";

import {
	buildTaskStartServicePromptContent,
	collectPendingTaskStartServicePrompts,
	detectTaskStartServicePromptIds,
	getStartableBacklogTaskIds,
	getTaskStartServicePromptKey,
	isTaskStartServicePromptAlreadyConfigured,
	mergeTaskStartServicePromptQueue,
} from "@/hooks/use-task-start-service-prompts";
import type { BoardCard, BoardData, BoardDependency } from "@/types";

describe("detectTaskStartServicePromptIds", () => {
	it("detects linear links", () => {
		expect(detectTaskStartServicePromptIds("Use https://linear.app/factory/issue/ABC-123 for context")).toEqual([
			"linear_mcp",
		]);
	});

	it("detects plain linear mentions", () => {
		expect(detectTaskStartServicePromptIds("Please sync this with linear before starting")).toEqual(["linear_mcp"]);
	});

	it("detects linear ticket ids", () => {
		expect(detectTaskStartServicePromptIds("Please fix linear issue ABC-321 today")).toEqual(["linear_mcp"]);
	});

	it("does not detect generic ticket ids without linear context", () => {
		expect(detectTaskStartServicePromptIds("Please fix issue ABC-321 today")).toEqual([]);
	});

	it("detects github links", () => {
		expect(detectTaskStartServicePromptIds("See https://github.com/cline/kanban/issues/42")).toEqual(["github_cli"]);
	});

	it("detects plain github mentions", () => {
		expect(detectTaskStartServicePromptIds("Please check github for related PRs")).toEqual(["github_cli"]);
	});

	it("detects both linear and github when both present", () => {
		const result = detectTaskStartServicePromptIds(
			"Investigate https://github.com/cline/kanban/issues/42 and then check LINEAR-12",
		);
		expect(result).toContain("github_cli");
		expect(result).toContain("linear_mcp");
	});
});

describe("buildTaskStartServicePromptContent", () => {
	it("returns codex-specific linear install command", () => {
		const content = buildTaskStartServicePromptContent("linear_mcp", {
			selectedAgentId: "codex",
		});
		expect(content.installCommand).toBe("codex mcp add linear --url https://mcp.linear.app/mcp");
		expect(content.learnMoreUrl).toBe("https://linear.app/docs/mcp");
	});

	it("returns droid-specific linear install command", () => {
		const content = buildTaskStartServicePromptContent("linear_mcp", {
			selectedAgentId: "droid",
		});
		expect(content.installCommand).toBe("droid mcp add linear https://mcp.linear.app/mcp --type http");
	});

	it("returns cline-specific linear install command", () => {
		const content = buildTaskStartServicePromptContent("linear_mcp", {
			selectedAgentId: "cline",
		});
		expect(content.installCommand).toBe("cline mcp add linear https://mcp.linear.app/mcp --type http");
	});

	it("returns gemini linear install command with user scope", () => {
		const content = buildTaskStartServicePromptContent("linear_mcp", {
			selectedAgentId: "gemini",
		});
		expect(content.installCommand).toBe(
			"gemini mcp add linear https://mcp.linear.app/mcp --transport http --scope user",
		);
	});

	it("returns claude default linear install command", () => {
		const content = buildTaskStartServicePromptContent("linear_mcp");
		expect(content.installCommand).toBe(
			"claude mcp add --transport http --scope user linear https://mcp.linear.app/mcp",
		);
	});

	it("returns github mac install command", () => {
		const content = buildTaskStartServicePromptContent("github_cli", {
			platform: "mac",
		});
		expect(content.installCommand).toBe("brew install gh");
		expect(content.learnMoreUrl).toBe("https://cli.github.com/");
	});

	it("returns github windows install command", () => {
		const content = buildTaskStartServicePromptContent("github_cli", {
			platform: "windows",
		});
		expect(content.installCommand).toBe("winget install --id GitHub.cli");
	});

	it("returns no github install command for unsupported platforms", () => {
		const content = buildTaskStartServicePromptContent("github_cli", {
			platform: "other",
		});
		expect(content.installCommand).toBeUndefined();
	});

	it("returns agent cli setup guidance with cline install command", () => {
		const content = buildTaskStartServicePromptContent("agent_cli");
		expect(content.installCommand).toBe("npm install -g cline");
		expect(content.installButtonLabel).toBe("Run install command");
		expect(content.title).toBe("Get started with Cline");
		expect(content.description).toContain("No authenticated agent is ready yet");
	});

	it("returns opencode-specific linear guidance with oauth", () => {
		const content = buildTaskStartServicePromptContent("linear_mcp", {
			selectedAgentId: "opencode",
		});
		expect(content.installCommand).toBe("opencode mcp add");
		expect(content.description).toContain("name: linear");
		expect(content.description).toContain("OAuth");
	});
});

describe("isTaskStartServicePromptAlreadyConfigured", () => {
	it("returns false when availability has not loaded", () => {
		expect(isTaskStartServicePromptAlreadyConfigured("linear_mcp", null)).toBe(false);
	});

	it("maps each prompt to its presence flag", () => {
		const availability = {
			githubCli: true,
			linearMcp: false,
		};

		expect(isTaskStartServicePromptAlreadyConfigured("linear_mcp", availability)).toBe(false);
		expect(isTaskStartServicePromptAlreadyConfigured("github_cli", availability)).toBe(true);
	});

	it("maps agent cli prompt to installed-agent state", () => {
		expect(isTaskStartServicePromptAlreadyConfigured("agent_cli", null, { isTaskAgentSetupSatisfied: false })).toBe(false);
		expect(isTaskStartServicePromptAlreadyConfigured("agent_cli", null, { isTaskAgentSetupSatisfied: true })).toBe(true);
	});
});

describe("getTaskStartServicePromptKey", () => {
	it("builds stable task prompt keys", () => {
		expect(getTaskStartServicePromptKey("task-1", "linear_mcp")).toBe("task-1:linear_mcp");
	});
});

describe("collectPendingTaskStartServicePrompts", () => {
	it("deduplicates prompts across multiple tasks while keeping affected task ids", () => {
		expect(
			collectPendingTaskStartServicePrompts({
				tasks: [
					{
						taskId: "task-1",
						prompt: "Check github issue and sync with linear",
					},
					{
						taskId: "task-2",
						prompt: "Investigate github PR history",
					},
				],
				taskStartSetupAvailability: null,
				promptAcknowledgements: {},
				isPromptDoNotShowAgainEnabled: () => false,
			}),
		).toEqual([
			{
				promptId: "linear_mcp",
				taskIds: ["task-1"],
			},
			{
				promptId: "github_cli",
				taskIds: ["task-1", "task-2"],
			},
		]);
	});

	it("filters out configured, acknowledged, and suppressed prompts", () => {
		expect(
			collectPendingTaskStartServicePrompts({
				tasks: [
					{
						taskId: "task-1",
						prompt: "Use github and linear context",
					},
				],
				taskStartSetupAvailability: {
					githubCli: true,
					linearMcp: false,
				},
				promptAcknowledgements: {
					[getTaskStartServicePromptKey("task-1", "linear_mcp")]: true,
				},
				isPromptDoNotShowAgainEnabled: () => false,
			}),
		).toEqual([]);
	});

	it("shows agent cli prompt first when no supported agent is installed", () => {
		expect(
			collectPendingTaskStartServicePrompts({
				tasks: [
					{
						taskId: "task-1",
						prompt: "Use github and linear context",
					},
					{
						taskId: "task-2",
						prompt: "No integrations needed",
					},
				],
				taskStartSetupAvailability: {
					githubCli: true,
					linearMcp: true,
				},
				isTaskAgentSetupSatisfied: false,
				promptAcknowledgements: {},
				isPromptDoNotShowAgainEnabled: () => false,
			}),
		).toEqual([
			{
				promptId: "agent_cli",
				taskIds: ["task-1", "task-2"],
			},
		]);
	});
});

describe("getStartableBacklogTaskIds", () => {
	function createCard(id: string, prompt = "Do something"): BoardCard {
		return {
			id,
			title: prompt,
			prompt,
			startInPlanMode: false,
			autoReviewEnabled: false,
			autoReviewMode: "commit",
			baseRef: "main",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};
	}

	function createBoard({
		backlogCards,
		dependencies = [],
		inProgressCards = [],
	}: {
		backlogCards: BoardCard[];
		dependencies?: BoardDependency[];
		inProgressCards?: BoardCard[];
	}): BoardData {
		return {
			columns: [
				{ id: "backlog", title: "Backlog", cards: backlogCards },
				{ id: "in_progress", title: "In Progress", cards: inProgressCards },
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Trash", cards: [] },
			],
			dependencies,
		};
	}

	it("returns all backlog task ids when there are no dependencies", () => {
		const board = createBoard({ backlogCards: [createCard("task-1"), createCard("task-2"), createCard("task-3")] });
		expect(getStartableBacklogTaskIds(board)).toEqual(["task-1", "task-2", "task-3"]);
	});

	it("returns empty array when backlog is empty", () => {
		const board = createBoard({ backlogCards: [] });
		expect(getStartableBacklogTaskIds(board)).toEqual([]);
	});

	it("excludes a parent task whose child is also in the backlog", () => {
		// A → B means A is parent, B is child. Child B should run first, so A is excluded.
		const board = createBoard({
			backlogCards: [createCard("task-a"), createCard("task-b")],
			dependencies: [{ id: "dep-1", fromTaskId: "task-a", toTaskId: "task-b", createdAt: 1 }],
		});
		expect(getStartableBacklogTaskIds(board)).toEqual(["task-b"]);
	});

	it("excludes a parent task whose child is in progress", () => {
		// A → B, B is in progress. A should wait for B to finish, so A is excluded.
		const board = createBoard({
			backlogCards: [createCard("task-a")],
			dependencies: [{ id: "dep-1", fromTaskId: "task-a", toTaskId: "task-b", createdAt: 1 }],
			inProgressCards: [createCard("task-b")],
		});
		expect(getStartableBacklogTaskIds(board)).toEqual([]);
	});

	it("includes a parent task whose child is in review (neither backlog nor in_progress)", () => {
		// A → B, B is in review. Child is done, so parent A can start.
		const board: BoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [createCard("task-a")] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [createCard("task-b")] },
				{ id: "trash", title: "Trash", cards: [] },
			],
			dependencies: [{ id: "dep-1", fromTaskId: "task-a", toTaskId: "task-b", createdAt: 1 }],
		};
		expect(getStartableBacklogTaskIds(board)).toEqual(["task-a"]);
	});

	it("only starts the leaf of a chain when all tasks are in the backlog (A → B → C)", () => {
		// A → B → C: C is the leaf child, should run first. A and B are excluded.
		const board = createBoard({
			backlogCards: [createCard("task-a"), createCard("task-b"), createCard("task-c")],
			dependencies: [
				{ id: "dep-1", fromTaskId: "task-a", toTaskId: "task-b", createdAt: 1 },
				{ id: "dep-2", fromTaskId: "task-b", toTaskId: "task-c", createdAt: 2 },
			],
		});
		expect(getStartableBacklogTaskIds(board)).toEqual(["task-c"]);
	});

	it("starts multiple independent leaf children while excluding their parents", () => {
		const board = createBoard({
			backlogCards: [createCard("parent-1"), createCard("child-1"), createCard("parent-2"), createCard("child-2")],
			dependencies: [
				{ id: "dep-1", fromTaskId: "parent-1", toTaskId: "child-1", createdAt: 1 },
				{ id: "dep-2", fromTaskId: "parent-2", toTaskId: "child-2", createdAt: 2 },
			],
		});
		expect(getStartableBacklogTaskIds(board)).toEqual(["child-1", "child-2"]);
	});

	it("excludes both parents in a diamond where two parents share a child in the backlog", () => {
		// task-a → task-c, task-b → task-c: both parents have a child in backlog, so both are excluded
		const board = createBoard({
			backlogCards: [createCard("task-a"), createCard("task-b"), createCard("task-c")],
			dependencies: [
				{ id: "dep-1", fromTaskId: "task-a", toTaskId: "task-c", createdAt: 1 },
				{ id: "dep-2", fromTaskId: "task-b", toTaskId: "task-c", createdAt: 2 },
			],
		});
		const result = getStartableBacklogTaskIds(board);
		expect(result).not.toContain("task-a");
		expect(result).not.toContain("task-b");
		expect(result).toContain("task-c");
	});

	it("includes a task whose dependency points to a non-existent child", () => {
		const board = createBoard({
			backlogCards: [createCard("task-a")],
			dependencies: [{ id: "dep-1", fromTaskId: "task-a", toTaskId: "ghost", createdAt: 1 }],
		});
		expect(getStartableBacklogTaskIds(board)).toEqual(["task-a"]);
	});
});

describe("mergeTaskStartServicePromptQueue", () => {
	it("appends new prompt kinds and merges task ids for existing prompt kinds", () => {
		expect(
			mergeTaskStartServicePromptQueue(
				[
					{
						promptId: "linear_mcp",
						taskIds: ["task-1"],
					},
				],
				[
					{
						promptId: "linear_mcp",
						taskIds: ["task-2", "task-1"],
					},
					{
						promptId: "github_cli",
						taskIds: ["task-3"],
					},
				],
			),
		).toEqual([
			{
				promptId: "linear_mcp",
				taskIds: ["task-1", "task-2"],
			},
			{
				promptId: "github_cli",
				taskIds: ["task-3"],
			},
		]);
	});

	it("returns next queue directly when current queue is empty", () => {
		expect(
			mergeTaskStartServicePromptQueue([], [
				{
					promptId: "github_cli",
					taskIds: ["task-1"],
				},
			]),
		).toEqual([
			{
				promptId: "github_cli",
				taskIds: ["task-1"],
			},
		]);
	});
});
