import { describe, expect, it, vi } from "vitest";

import { createProjectMemoryConsolidator } from "../../src/cline-sdk/cline-project-memory-consolidator";

function createHost(result: unknown) {
	return {
		start: vi.fn(async () => ({ sessionId: "memory-session", result: null })),
		send: vi.fn(async () => result),
		stop: vi.fn(async () => undefined),
		delete: vi.fn(async () => true),
		dispose: vi.fn(async () => undefined),
	};
}

describe("project memory consolidator", () => {
	it("returns validated Markdown from a tools-disabled one-shot model session", async () => {
		const host = createHost({ text: "```markdown\n# Project\n\n- Use npm test.\n```" });
		const consolidate = createProjectMemoryConsolidator({
			resolveLaunchConfig: vi.fn(async () => ({
				providerId: "lmstudio",
				modelId: "qwen",
				apiKey: null,
				baseUrl: "http://localhost:8800/v1",
			})),
			createSessionHost: vi.fn(async () => host as never),
		});

		const result = await consolidate({
			workspacePath: "C:\\repo",
			currentMemory: "# Project\n\n- Old command.",
			taskId: "task-1",
			taskTitle: "Fix tests",
			taskSummary: "Use npm test.",
		});

		expect(result).toBe("# Project\n\n- Use npm test.");
		expect(host.start).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					providerId: "lmstudio",
					modelId: "qwen",
					enableTools: false,
					systemPrompt: expect.stringContaining("fewest words"),
				}),
			}),
		);
		expect(host.send).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "memory-session",
				prompt: expect.stringContaining('"taskId":"task-1"'),
			}),
		);
		expect(host.stop).toHaveBeenCalledWith("memory-session");
		expect(host.delete).toHaveBeenCalledWith("memory-session");
		expect(host.dispose).toHaveBeenCalledOnce();
	});

	it("accepts large output without imposing a character limit", async () => {
		const largeOutput = "x".repeat(25_000);
		const host = createHost({ text: largeOutput });
		const consolidate = createProjectMemoryConsolidator({
			resolveLaunchConfig: vi.fn(async () => ({
				providerId: "lmstudio",
				modelId: "qwen",
				apiKey: null,
				baseUrl: null,
			})),
			createSessionHost: vi.fn(async () => host as never),
		});

		await expect(
			consolidate({
				workspacePath: "C:\\repo",
				currentMemory: "",
				taskId: "task-1",
				taskTitle: "Task",
				taskSummary: "Summary",
			}),
		).resolves.toBe(largeOutput);
		expect(host.stop).toHaveBeenCalledWith("memory-session");
		expect(host.delete).toHaveBeenCalledWith("memory-session");
		expect(host.dispose).toHaveBeenCalledOnce();
	});

	it("allows the model to remove project memory that contains no durable knowledge", async () => {
		const host = createHost({ text: "<!-- empty -->" });
		const consolidate = createProjectMemoryConsolidator({
			resolveLaunchConfig: vi.fn(async () => ({
				providerId: "lmstudio",
				modelId: "qwen",
				apiKey: null,
				baseUrl: null,
			})),
			createSessionHost: vi.fn(async () => host as never),
		});

		await expect(
			consolidate({
				workspacePath: "C:\\repo",
				currentMemory: "Generic assistant introduction",
				taskId: "task-1",
				taskTitle: "Who are you",
				taskSummary: "Generic assistant introduction",
			}),
		).resolves.toBe("");
	});
});
