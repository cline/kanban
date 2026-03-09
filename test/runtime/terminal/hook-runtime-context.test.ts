import { describe, expect, it } from "vitest";

import {
	createHookRuntimeEnv,
	KANBANANA_HOOK_TASK_ID_ENV,
	KANBANANA_HOOK_WORKSPACE_ID_ENV,
	parseHookRuntimeContextFromEnv,
} from "../../../src/terminal/hook-runtime-context.js";

describe("hook-runtime-context", () => {
	it("creates expected environment variables", () => {
		const env = createHookRuntimeEnv({
			taskId: "task-1",
			workspaceId: "workspace-1",
		});
		expect(env).toEqual({
			[KANBANANA_HOOK_TASK_ID_ENV]: "task-1",
			[KANBANANA_HOOK_WORKSPACE_ID_ENV]: "workspace-1",
		});
	});

	it("parses hook runtime context from env", () => {
		const parsed = parseHookRuntimeContextFromEnv({
			[KANBANANA_HOOK_TASK_ID_ENV]: "task-2",
			[KANBANANA_HOOK_WORKSPACE_ID_ENV]: "workspace-2",
		});
		expect(parsed).toEqual({
			taskId: "task-2",
			workspaceId: "workspace-2",
		});
	});

	it("throws when required env vars are missing", () => {
		expect(() => parseHookRuntimeContextFromEnv({})).toThrow(
			`Missing required environment variable: ${KANBANANA_HOOK_TASK_ID_ENV}`,
		);
	});
});
