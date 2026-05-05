import type { RuntimeHookEvent } from "../core/api-contract";
import { buildKanbanCommandParts } from "../core/kanban-command";
import { quoteShellArg } from "../core/shell";

const CODEX_HOOK_TIMEOUT_SECONDS = 5;

export function hasCodexConfigOverride(args: string[], key: string): boolean {
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "-c" || arg === "--config") {
			const next = args[i + 1];
			if (typeof next === "string" && next.startsWith(`${key}=`)) {
				return true;
			}
			i += 1;
			continue;
		}
		if (arg.startsWith(`-c${key}=`) || arg.startsWith(`--config=${key}=`)) {
			return true;
		}
	}
	return false;
}

function addCodexConfigOverride(args: string[], key: string, value: string): void {
	if (hasCodexConfigOverride(args, key)) {
		return;
	}
	args.push("-c", `${key}=${value}`);
}

function buildCodexHookCommand(event: RuntimeHookEvent): string {
	return buildKanbanCommandParts(["hooks", "codex-hook", "--event", event, "--source", "codex"])
		.map(quoteShellArg)
		.join(" ");
}

function buildCodexHookConfigValue(command: string, matcher?: string): string {
	const matcherConfig = matcher ? `matcher=${JSON.stringify(matcher)},` : "";
	return `[{${matcherConfig}hooks=[{type="command",command=${JSON.stringify(command)},timeout=${CODEX_HOOK_TIMEOUT_SECONDS}}]}]`;
}

export function configureCodexHooks(args: string[]): void {
	const inProgressHookConfig = buildCodexHookConfigValue(buildCodexHookCommand("to_in_progress"));
	const reviewHookConfig = buildCodexHookConfigValue(buildCodexHookCommand("to_review"));
	const activityHookConfig = buildCodexHookConfigValue(buildCodexHookCommand("activity"), "*");

	addCodexConfigOverride(args, "features.codex_hooks", "true");
	addCodexConfigOverride(args, "hooks.UserPromptSubmit", inProgressHookConfig);
	addCodexConfigOverride(args, "hooks.Stop", reviewHookConfig);
	addCodexConfigOverride(
		args,
		"hooks.PermissionRequest",
		buildCodexHookConfigValue(buildCodexHookCommand("to_review"), "*"),
	);
	addCodexConfigOverride(args, "hooks.PreToolUse", activityHookConfig);
	addCodexConfigOverride(args, "hooks.PostToolUse", activityHookConfig);
}
