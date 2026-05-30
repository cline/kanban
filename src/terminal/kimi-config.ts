import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { RuntimeHookEvent } from "../core/api-contract";
import { lockedFileSystem } from "../fs/locked-file-system";

const KIMI_KANBAN_CONFIG_REGION_START = "# <kanban-kimi-hooks>";
const KIMI_KANBAN_CONFIG_REGION_END = "# </kanban-kimi-hooks>";

type KimiHookEvent =
	| "UserPromptSubmit"
	| "PreToolUse"
	| "PostToolUse"
	| "PostToolUseFailure"
	| "Notification"
	| "Stop"
	| "StopFailure"
	| "SubagentStop";

export interface KimiHookCommandMetadata {
	activityText?: string;
	hookEventName: KimiHookEvent;
	source: "kimi";
}

export type KimiHookCommandBuilder = (event: RuntimeHookEvent, metadata: KimiHookCommandMetadata) => string;

interface KimiHookDefinition {
	event: KimiHookEvent;
	command: string;
	matcher?: string;
}

export interface EnsureKimiKanbanConfigInput {
	buildHookCommand: KimiHookCommandBuilder;
	configPath: string;
	env?: Record<string, string | undefined>;
}

export function getKimiKanbanConfigPath(runtimeHomePath: string): string {
	return join(runtimeHomePath, "hooks", "kimi", "config.toml");
}

export function getKimiDefaultConfigPath(env: Record<string, string | undefined> | undefined): string {
	const explicitHome =
		env?.KIMI_SHARE_DIR?.trim() ||
		process.env.KIMI_SHARE_DIR?.trim() ||
		env?.KIMI_CODE_HOME?.trim() ||
		process.env.KIMI_CODE_HOME?.trim();
	return join(explicitHome || join(homedir(), ".kimi"), "config.toml");
}

async function readTextFileIfExists(filePath: string): Promise<string | null> {
	try {
		return await readFile(filePath, "utf8");
	} catch {
		return null;
	}
}

function tomlBasicString(value: string): string {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\r", "\\r")}"`;
}

function stripKimiKanbanConfigRegion(content: string): string {
	const startIndex = content.indexOf(KIMI_KANBAN_CONFIG_REGION_START);
	if (startIndex < 0) {
		return content.trimEnd();
	}
	const endIndex = content.indexOf(KIMI_KANBAN_CONFIG_REGION_END, startIndex);
	if (endIndex < 0) {
		return content.slice(0, startIndex).trimEnd();
	}
	return `${content.slice(0, startIndex)}${content.slice(endIndex + KIMI_KANBAN_CONFIG_REGION_END.length)}`.trimEnd();
}

function countTomlArrayBracketDelta(line: string): number {
	let delta = 0;
	let quote: '"' | "'" | null = null;
	let isEscaped = false;
	for (const char of line) {
		if (quote) {
			if (quote === '"' && char === "\\" && !isEscaped) {
				isEscaped = true;
				continue;
			}
			if (char === quote && !isEscaped) {
				quote = null;
			}
			isEscaped = false;
			continue;
		}
		if (char === "#") {
			break;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === "[") {
			delta += 1;
		} else if (char === "]") {
			delta -= 1;
		}
	}
	return delta;
}

function findFirstTomlTableLineIndex(lines: readonly string[]): number {
	return lines.findIndex((line) => /^\s*\[/.test(line));
}

function extractTomlArrayBody(block: string): string {
	const startIndex = block.indexOf("[");
	const endIndex = block.lastIndexOf("]");
	if (startIndex < 0 || endIndex <= startIndex) {
		return "";
	}
	return block.slice(startIndex + 1, endIndex).trim();
}

function removeTopLevelKimiHooksAssignment(content: string): { content: string; hooksBody: string } {
	const lines = content.split("\n");
	const firstTableLineIndex = findFirstTomlTableLineIndex(lines);
	const topLevelEndIndex = firstTableLineIndex < 0 ? lines.length : firstTableLineIndex;
	const startIndex = lines.findIndex((line, index) => index < topLevelEndIndex && /^\s*hooks\s*=/.test(line));
	if (startIndex < 0) {
		return {
			content: content.trimEnd(),
			hooksBody: "",
		};
	}

	let endIndex = startIndex;
	let bracketDepth = 0;
	for (let index = startIndex; index < topLevelEndIndex; index += 1) {
		bracketDepth += countTomlArrayBracketDelta(lines[index] ?? "");
		endIndex = index;
		if (bracketDepth <= 0) {
			break;
		}
	}

	const hooksBlock = lines.slice(startIndex, endIndex + 1).join("\n");
	const contentWithoutHooks = [...lines.slice(0, startIndex), ...lines.slice(endIndex + 1)].join("\n").trimEnd();
	return {
		content: contentWithoutHooks,
		hooksBody: extractTomlArrayBody(hooksBlock),
	};
}

function ensureTomlArrayBodyTrailingComma(lines: string[]): string[] {
	let lastValueIndex = -1;
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const trimmed = lines[index]?.trim() ?? "";
		if (trimmed !== "" && !trimmed.startsWith("#")) {
			lastValueIndex = index;
			break;
		}
	}
	if (lastValueIndex < 0) {
		return lines;
	}
	const lastLine = lines[lastValueIndex] ?? "";
	if (lastLine.trimEnd().endsWith(",")) {
		return lines;
	}
	const nextLines = [...lines];
	nextLines[lastValueIndex] = `${lastLine},`;
	return nextLines;
}

function indentTomlArrayBody(body: string): string[] {
	if (!body.trim()) {
		return [];
	}
	return ensureTomlArrayBodyTrailingComma(body.trim().split("\n")).map((line) => `  ${line.trimEnd()}`);
}

function formatKimiHookDefinition(hook: KimiHookDefinition): string {
	const fields = [`event = ${tomlBasicString(hook.event)}`];
	if (hook.matcher) {
		fields.push(`matcher = ${tomlBasicString(hook.matcher)}`);
	}
	fields.push(`command = ${tomlBasicString(hook.command)}`, "timeout = 5");
	return `{ ${fields.join(", ")} }`;
}

function buildKimiKanbanHookDefinitions(buildHookCommand: KimiHookCommandBuilder): KimiHookDefinition[] {
	return [
		{
			event: "UserPromptSubmit",
			command: buildHookCommand("to_in_progress", { source: "kimi", hookEventName: "UserPromptSubmit" }),
		},
		{
			event: "PreToolUse",
			command: buildHookCommand("activity", { source: "kimi", hookEventName: "PreToolUse" }),
		},
		{
			event: "PreToolUse",
			command: buildHookCommand("to_in_progress", { source: "kimi", hookEventName: "PreToolUse" }),
		},
		{
			event: "PostToolUse",
			command: buildHookCommand("activity", { source: "kimi", hookEventName: "PostToolUse" }),
		},
		{
			event: "PostToolUseFailure",
			command: buildHookCommand("activity", { source: "kimi", hookEventName: "PostToolUseFailure" }),
		},
		{
			event: "Notification",
			matcher: "permission|approval|attention",
			command: buildHookCommand("to_review", { source: "kimi", hookEventName: "Notification" }),
		},
		{
			event: "Notification",
			command: buildHookCommand("activity", { source: "kimi", hookEventName: "Notification" }),
		},
		{
			event: "Stop",
			command: buildHookCommand("to_review", {
				source: "kimi",
				hookEventName: "Stop",
				activityText: "Waiting for review",
			}),
		},
		{
			event: "StopFailure",
			command: buildHookCommand("to_review", { source: "kimi", hookEventName: "StopFailure" }),
		},
		{
			event: "SubagentStop",
			command: buildHookCommand("activity", { source: "kimi", hookEventName: "SubagentStop" }),
		},
	];
}

export function buildKimiKanbanConfigContent(baseContent: string, buildHookCommand: KimiHookCommandBuilder): string {
	const baseConfig = stripKimiKanbanConfigRegion(baseContent);
	const existingHooks = removeTopLevelKimiHooksAssignment(baseConfig);
	const hooksLines = [
		"hooks = [",
		...indentTomlArrayBody(existingHooks.hooksBody),
		...(existingHooks.hooksBody.trim() ? [""] : []),
		`  ${KIMI_KANBAN_CONFIG_REGION_START}`,
		...buildKimiKanbanHookDefinitions(buildHookCommand).map((hook) => `  ${formatKimiHookDefinition(hook)},`),
		`  ${KIMI_KANBAN_CONFIG_REGION_END}`,
		"]",
	];
	const tableLineIndex = findFirstTomlTableLineIndex(existingHooks.content.split("\n"));
	if (tableLineIndex < 0) {
		const prefix = existingHooks.content.trimEnd();
		return prefix ? `${prefix}\n${hooksLines.join("\n")}\n` : `${hooksLines.join("\n")}\n`;
	}
	const lines = existingHooks.content.split("\n");
	const topLevelLines = lines.slice(0, tableLineIndex).join("\n").trimEnd();
	const tableLines = lines.slice(tableLineIndex).join("\n").trimEnd();
	const prefix = topLevelLines ? `${topLevelLines}\n` : "";
	const suffix = tableLines ? `\n\n${tableLines}\n` : "\n";
	return `${prefix}${hooksLines.join("\n")}${suffix}`;
}

export async function ensureKimiKanbanConfig(input: EnsureKimiKanbanConfigInput): Promise<string> {
	const baseConfigPath = getKimiDefaultConfigPath(input.env);
	const baseContent =
		(await readTextFileIfExists(baseConfigPath)) ?? (await readTextFileIfExists(input.configPath)) ?? "";
	await lockedFileSystem.writeTextFileAtomic(
		input.configPath,
		buildKimiKanbanConfigContent(baseContent, input.buildHookCommand),
	);
	return input.configPath;
}
