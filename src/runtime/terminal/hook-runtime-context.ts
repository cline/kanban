export const KANBANANA_HOOK_TASK_ID_ENV = "KANBANANA_HOOK_TASK_ID";
export const KANBANANA_HOOK_WORKSPACE_ID_ENV = "KANBANANA_HOOK_WORKSPACE_ID";
export const KANBANANA_HOOK_PORT_ENV = "KANBANANA_HOOK_PORT";

export interface HookRuntimeContext {
	taskId: string;
	workspaceId: string;
	port: number;
}

function requireTrimmedEnv(env: NodeJS.ProcessEnv, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`Missing required environment variable: ${key}`);
	}
	return value;
}

function parsePort(port: string): number {
	const parsed = Number.parseInt(port, 10);
	if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
		throw new Error(`Invalid port "${port}" in ${KANBANANA_HOOK_PORT_ENV}. Must be a number between 1 and 65535`);
	}
	return parsed;
}

export function createHookRuntimeEnv(context: HookRuntimeContext): Record<string, string> {
	return {
		[KANBANANA_HOOK_TASK_ID_ENV]: context.taskId,
		[KANBANANA_HOOK_WORKSPACE_ID_ENV]: context.workspaceId,
		[KANBANANA_HOOK_PORT_ENV]: String(context.port),
	};
}

export function parseHookRuntimeContextFromEnv(env: NodeJS.ProcessEnv = process.env): HookRuntimeContext {
	const taskId = requireTrimmedEnv(env, KANBANANA_HOOK_TASK_ID_ENV);
	const workspaceId = requireTrimmedEnv(env, KANBANANA_HOOK_WORKSPACE_ID_ENV);
	const port = parsePort(requireTrimmedEnv(env, KANBANANA_HOOK_PORT_ENV));
	return {
		taskId,
		workspaceId,
		port,
	};
}
