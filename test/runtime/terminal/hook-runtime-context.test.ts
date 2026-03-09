import { describe, expect, it } from "vitest";

import {
	createHookRuntimeEnv,
	KANBAN_HOOK_TASK_ID_ENV,
	KANBAN_HOOK_WORKSPACE_ID_ENV,
	parseHookRuntimeContextFromEnv,
} from "../../../src/terminal/hook-runtime-context.js";

describe("hook-runtime-context", () => {
	it("creates expected environment variables", () => {
		const env = createHookRuntimeEnv({
			taskId: "task-1",
			workspaceId: "workspace-1",
		});
		expect(env).toEqual({
			[KANBAN_HOOK_TASK_ID_ENV]: "task-1",
			[KANBAN_HOOK_WORKSPACE_ID_ENV]: "workspace-1",
		});
	});

	it("parses hook runtime context from env", () => {
		const parsed = parseHookRuntimeContextFromEnv({
			[KANBAN_HOOK_TASK_ID_ENV]: "task-2",
			[KANBAN_HOOK_WORKSPACE_ID_ENV]: "workspace-2",
		});
		expect(parsed).toEqual({
			taskId: "task-2",
			workspaceId: "workspace-2",
		});
	});

	it("throws when required env vars are missing", () => {
		expect(() => parseHookRuntimeContextFromEnv({})).toThrow(
			`Missing required environment variable: ${KANBAN_HOOK_TASK_ID_ENV}`,
		);
	});
});
