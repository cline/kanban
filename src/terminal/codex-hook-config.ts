import { createHash } from "node:crypto";

import type { RuntimeHookEvent } from "../core/api-contract";
import { buildKanbanCommandParts } from "../core/kanban-command";
import { quoteShellArg } from "../core/shell";

const CODEX_HOOK_TIMEOUT_SECONDS = 5;

type CodexHookConfigEvent = "PermissionRequest" | "PostToolUse" | "PreToolUse" | "Stop" | "UserPromptSubmit";

type JsonValue = JsonPrimitive | JsonArray | JsonObject;
type JsonPrimitive = boolean | null | number | string;
type JsonArray = JsonValue[];
interface JsonObject {
	[key: string]: JsonValue;
}

interface CodexHookConfig {
	eventName: CodexHookConfigEvent;
	matcher?: string;
	command: string;
}

interface CodexHookTrustEntry {
	key: string;
	trustedHash: string;
}

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

function prependCodexConfigOverride(args: string[], key: string, value: string): void {
	args.unshift("-c", `${key}=${value}`);
}

function buildCodexHookCommand(event: RuntimeHookEvent): string {
	return buildKanbanCommandParts(["hooks", "codex-hook", "--event", event, "--source", "codex"])
		.map(quoteShellArg)
		.join(" ");
}

function buildCodexHookConfigValue(command: string, matcher?: string): string {
	const matcherConfig = matcher ? `matcher=${JSON.stringify(matcher)},` : "";
	const commandConfig = JSON.stringify(command);
	return `[{${matcherConfig}hooks=[{type="command",command=${commandConfig},timeout=${CODEX_HOOK_TIMEOUT_SECONDS}}]}]`;
}

function codexSessionFlagsConfigSource(): string {
	return process.platform === "win32" ? String.raw`C:\<session-flags>\config.toml` : "/<session-flags>/config.toml";
}

function codexHookEventKeyLabel(eventName: CodexHookConfigEvent): string {
	switch (eventName) {
		case "PermissionRequest":
			return "permission_request";
		case "PostToolUse":
			return "post_tool_use";
		case "PreToolUse":
			return "pre_tool_use";
		case "Stop":
			return "stop";
		case "UserPromptSubmit":
			return "user_prompt_submit";
	}
}

function canonicalizeJson(value: JsonValue): JsonValue {
	if (Array.isArray(value)) {
		return value.map(canonicalizeJson);
	}
	if (value !== null && typeof value === "object") {
		const sorted: JsonObject = {};
		for (const key of Object.keys(value).sort()) {
			sorted[key] = canonicalizeJson(value[key]);
		}
		return sorted;
	}
	return value;
}

function versionForCodexHookIdentity(value: JsonObject): string {
	const canonical = canonicalizeJson(value);
	const serialized = JSON.stringify(canonical);
	const hash = createHash("sha256").update(serialized).digest("hex");
	return `sha256:${hash}`;
}

function buildCodexHookTrustEntry(config: CodexHookConfig): CodexHookTrustEntry {
	const handler: JsonObject = {
		async: false,
		command: config.command,
		timeout: CODEX_HOOK_TIMEOUT_SECONDS,
		type: "command",
	};
	const group: JsonObject = {
		hooks: [handler],
	};
	if (config.matcher !== undefined) {
		group.matcher = config.matcher;
	}
	const eventKeyLabel = codexHookEventKeyLabel(config.eventName);
	const identity: JsonObject = {
		event_name: eventKeyLabel,
		...group,
	};
	return {
		key: `${codexSessionFlagsConfigSource()}:${eventKeyLabel}:0:0`,
		trustedHash: versionForCodexHookIdentity(identity),
	};
}

function buildCodexHookTrustStateConfigValue(entries: CodexHookTrustEntry[]): string {
	const states = entries.map(
		(entry) => `${JSON.stringify(entry.key)}={trusted_hash=${JSON.stringify(entry.trustedHash)}}`,
	);
	return `{${states.join(",")}}`;
}

export function configureCodexHooks(args: string[]): void {
	const inProgressHook: CodexHookConfig = {
		eventName: "UserPromptSubmit",
		command: buildCodexHookCommand("to_in_progress"),
	};
	const reviewHook: CodexHookConfig = {
		eventName: "Stop",
		command: buildCodexHookCommand("to_review"),
	};
	const permissionRequestHook: CodexHookConfig = {
		eventName: "PermissionRequest",
		command: buildCodexHookCommand("to_review"),
		matcher: "*",
	};
	const preToolUseActivityHook: CodexHookConfig = {
		eventName: "PreToolUse",
		command: buildCodexHookCommand("activity"),
		matcher: "*",
	};
	const postToolUseActivityHook: CodexHookConfig = {
		eventName: "PostToolUse",
		command: buildCodexHookCommand("activity"),
		matcher: "*",
	};
	const trustStateConfigValue = buildCodexHookTrustStateConfigValue(
		[inProgressHook, reviewHook, permissionRequestHook, preToolUseActivityHook, postToolUseActivityHook].map(
			buildCodexHookTrustEntry,
		),
	);

	addCodexConfigOverride(args, "features.hooks", "true");
	prependCodexConfigOverride(args, "hooks.state", trustStateConfigValue);
	addCodexConfigOverride(args, "hooks.UserPromptSubmit", buildCodexHookConfigValue(inProgressHook.command));
	addCodexConfigOverride(args, "hooks.Stop", buildCodexHookConfigValue(reviewHook.command));
	addCodexConfigOverride(
		args,
		"hooks.PermissionRequest",
		buildCodexHookConfigValue(permissionRequestHook.command, permissionRequestHook.matcher),
	);
	addCodexConfigOverride(
		args,
		"hooks.PreToolUse",
		buildCodexHookConfigValue(preToolUseActivityHook.command, preToolUseActivityHook.matcher),
	);
	addCodexConfigOverride(
		args,
		"hooks.PostToolUse",
		buildCodexHookConfigValue(postToolUseActivityHook.command, postToolUseActivityHook.matcher),
	);
}
