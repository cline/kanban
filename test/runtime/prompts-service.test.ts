import { describe, expect, it, vi, beforeEach } from "vitest";

// We test the internal helpers by importing the service module.
// The actual GitHub fetch is mocked to avoid network calls.

import { fetchPromptsCatalog, resetPromptsCatalogCache } from "../../src/services/prompts-service.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const MOCK_TREE_RESPONSE = {
	sha: "abc123",
	url: "https://api.github.com/repos/cline/prompts/git/trees/main",
	tree: [
		{ path: ".clinerules/test-rule.md", mode: "100644", type: "blob", sha: "a1", url: "" },
		{ path: "workflows/test-workflow.md", mode: "100644", type: "blob", sha: "a2", url: "" },
		{ path: "README.md", mode: "100644", type: "blob", sha: "a3", url: "" },
	],
	truncated: false,
};

const MOCK_RULE_CONTENT = `---
description: A test rule for linting
author: https://github.com/testauthor
category: Code Quality
tags: ["lint", "testing"]
version: 1.0.0
---

# Test Rule

Always lint your code before committing.
`;

const MOCK_WORKFLOW_CONTENT = `---
description: A test workflow for CI
author: testauthor2
category: CI/CD
tags: ["ci", "deploy"]
version: 2.0.0
globs: ["*.yml"]
---

# Test Workflow

Run tests then deploy.
`;

const MOCK_COMMIT_RESPONSE = [
	{
		commit: {
			author: {
				date: "2025-01-15T10:00:00Z",
			},
		},
	},
];

function createMockResponse(body: unknown, ok = true, status = 200): Response {
	return {
		ok,
		status,
		statusText: ok ? "OK" : "Error",
		json: async () => body,
		text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
		headers: new Headers(),
		redirected: false,
		type: "basic" as Response["type"],
		url: "",
		clone() {
			return createMockResponse(body, ok, status);
		},
		body: null,
		bodyUsed: false,
		arrayBuffer: async () => new ArrayBuffer(0),
		blob: async () => new Blob([]),
		formData: async () => new FormData(),
		bytes: async () => new Uint8Array(0),
	} as Response;
}

describe("prompts-service", () => {
	beforeEach(() => {
		resetPromptsCatalogCache();
		mockFetch.mockReset();
	});

	it("fetches and parses the community prompts catalog", async () => {
		mockFetch.mockImplementation(async (url: string) => {
			if (url.includes("/git/trees/")) {
				return createMockResponse(MOCK_TREE_RESPONSE);
			}
			if (url.includes("raw.githubusercontent.com") && url.includes("test-rule")) {
				return createMockResponse(MOCK_RULE_CONTENT);
			}
			if (url.includes("raw.githubusercontent.com") && url.includes("test-workflow")) {
				return createMockResponse(MOCK_WORKFLOW_CONTENT);
			}
			if (url.includes("/commits?")) {
				return createMockResponse(MOCK_COMMIT_RESPONSE);
			}
			return createMockResponse({}, false, 404);
		});

		const catalog = await fetchPromptsCatalog();

		expect(catalog.items).toHaveLength(2);
		expect(catalog.lastUpdated).toBeTruthy();

		const rule = catalog.items.find((item) => item.promptId === "test-rule");
		expect(rule).toBeDefined();
		expect(rule!.type).toBe("rule");
		expect(rule!.description).toBe("A test rule for linting");
		expect(rule!.author).toBe("testauthor");
		expect(rule!.category).toBe("Code Quality");
		expect(rule!.tags).toEqual(["lint", "testing"]);
		expect(rule!.version).toBe("1.0.0");
		expect(rule!.githubUrl).toContain("github.com/cline/prompts");

		const workflow = catalog.items.find((item) => item.promptId === "test-workflow");
		expect(workflow).toBeDefined();
		expect(workflow!.type).toBe("workflow");
		expect(workflow!.description).toBe("A test workflow for CI");
		expect(workflow!.author).toBe("testauthor2");
		expect(workflow!.category).toBe("CI/CD");
		expect(workflow!.globs).toEqual(["*.yml"]);
	});

	it("returns cached catalog on subsequent calls", async () => {
		mockFetch.mockImplementation(async (url: string) => {
			if (url.includes("/git/trees/")) {
				return createMockResponse(MOCK_TREE_RESPONSE);
			}
			if (url.includes("raw.githubusercontent.com")) {
				return createMockResponse(MOCK_RULE_CONTENT);
			}
			if (url.includes("/commits?")) {
				return createMockResponse(MOCK_COMMIT_RESPONSE);
			}
			return createMockResponse({}, false, 404);
		});

		const catalog1 = await fetchPromptsCatalog();
		const catalog2 = await fetchPromptsCatalog();

		expect(catalog1).toBe(catalog2);
		// Should only call tree API once due to caching
		const treeCalls = mockFetch.mock.calls.filter((call) => String(call[0]).includes("/git/trees/"));
		expect(treeCalls).toHaveLength(1);
	});

	it("returns empty catalog on API failure", async () => {
		mockFetch.mockImplementation(async () => createMockResponse({}, false, 500));

		const catalog = await fetchPromptsCatalog();

		expect(catalog.items).toHaveLength(0);
		expect(catalog.lastUpdated).toBeTruthy();
	});

	it("skips files outside known directories", async () => {
		mockFetch.mockImplementation(async (url: string) => {
			if (url.includes("/git/trees/")) {
				return createMockResponse({
					...MOCK_TREE_RESPONSE,
					tree: [
						{ path: "unknown-dir/file.md", mode: "100644", type: "blob", sha: "x1", url: "" },
						{ path: "README.md", mode: "100644", type: "blob", sha: "x2", url: "" },
					],
				});
			}
			return createMockResponse(MOCK_COMMIT_RESPONSE);
		});

		const catalog = await fetchPromptsCatalog();
		expect(catalog.items).toHaveLength(0);
	});
});
