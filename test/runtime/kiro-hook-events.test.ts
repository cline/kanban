import { describe, expect, it } from "vitest";
import { normalizeKiroHookMetadata } from "../../src/commands/hook-events/kiro-hook-events";

describe("normalizeKiroHookMetadata", () => {
	it("extracts tool input summary from Kiro operation payloads", () => {
		const metadata = normalizeKiroHookMetadata({
			event: "activity",
			sourceHint: "kiro",
			flagMetadata: {
				source: "kiro",
			},
			payload: {
				hook_event_name: "preToolUse",
				preToolUse: {
					tool: "fs_write",
					input: {
						operations: [
							{
								mode: "str_replace",
								path: "src/index.ts",
							},
						],
					},
				},
			},
		});

		expect(metadata).toMatchObject({
			source: "kiro",
			hookEventName: "preToolUse",
			toolName: "fs_write",
			activityText: "Using fs_write: src/index.ts",
		});
	});

	it("keeps explicit activity text metadata over inferred values", () => {
		const metadata = normalizeKiroHookMetadata({
			event: "activity",
			sourceHint: "kiro",
			flagMetadata: {
				source: "kiro",
				activityText: "Manual activity",
			},
			payload: {
				hook_event_name: "preToolUse",
				preToolUse: {
					tool: "fs_write",
					input: {
						operations: [
							{
								path: "src/index.ts",
							},
						],
					},
				},
			},
		});

		expect(metadata?.activityText).toBe("Manual activity");
	});

	it("uses final message activity for stop hooks", () => {
		const metadata = normalizeKiroHookMetadata({
			event: "to_review",
			sourceHint: "kiro",
			flagMetadata: {
				source: "kiro",
			},
			payload: {
				hook_event_name: "stop",
				assistant_response: "Finished implementing changes",
			},
		});

		expect(metadata).toMatchObject({
			finalMessage: "Finished implementing changes",
			activityText: "Final: Finished implementing changes",
		});
	});

	it("prefers detailed preToolUse input over top-level tool_input", () => {
		const metadata = normalizeKiroHookMetadata({
			event: "activity",
			sourceHint: "kiro",
			flagMetadata: {
				source: "kiro",
			},
			payload: {
				hook_event_name: "preToolUse",
				tool_input: {
					mode: "str_replace",
				},
				preToolUse: {
					tool: "fs_write",
					input: {
						operations: [
							{
								mode: "str_replace",
								path: "src/create-file.ts",
							},
						],
					},
				},
			},
		});

		expect(metadata).toMatchObject({
			toolName: "fs_write",
			activityText: "Using fs_write: src/create-file.ts",
		});
	});

	it("prefers top-level tool_input over preToolUse parameters when parameters only include mode", () => {
		const metadata = normalizeKiroHookMetadata({
			event: "activity",
			sourceHint: "kiro",
			flagMetadata: {
				source: "kiro",
			},
			payload: {
				hook_event_name: "preToolUse",
				tool_input: {
					path: "src/from-tool-input.ts",
					mode: "create",
				},
				preToolUse: {
					tool: "fs_write",
					parameters: {
						mode: "create",
					},
				},
			},
		});

		expect(metadata).toMatchObject({
			toolName: "fs_write",
			activityText: "Using fs_write: src/from-tool-input.ts",
		});
	});

	it("uses the file path from the real Kiro fs_write payload shape", () => {
		const metadata = normalizeKiroHookMetadata({
			event: "activity",
			sourceHint: "kiro",
			flagMetadata: {
				source: "kiro",
			},
			payload: {
				hook_event_name: "preToolUse",
				cwd: "/private/tmp/kanban-kiro-hook-debug",
				tool_name: "fs_write",
				tool_input: {
					command: "create",
					path: "/private/tmp/kanban-kiro-hook-debug/debug-target.txt",
					file_text: "hello from hook debug",
				},
			},
		});

		expect(metadata).toMatchObject({
			toolName: "fs_write",
			activityText: "Using fs_write: /private/tmp/kanban-kiro-hook-debug/debug-target.txt",
		});
	});
});
