import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

import type { RuntimeSlashCommandDescription } from "../api-contract.js";
import type { ResolvedAgentCommand } from "./agent-registry.js";

const execFileAsync = promisify(execFile);
const DISCOVERY_CACHE_TTL_MS = 60_000;
const DISCOVERY_TIMEOUT_MS = 20_000;
const DISCOVERY_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

type CommandFamily = "claude" | "codex" | "gemini" | "opencode" | "unknown";

interface SlashCommandCacheEntry {
	expiresAt: number;
	commands: RuntimeSlashCommandDescription[];
	error: string | null;
}

const slashCommandCache = new Map<string, SlashCommandCacheEntry>();

const CLAUDE_DEFAULT_COMMANDS: RuntimeSlashCommandDescription[] = [
	{ name: "compact", description: "Compact conversation context." },
	{ name: "review", description: "Review a pull request." },
	{
		name: "security-review",
		description: "Complete a security review of pending changes on the current branch.",
	},
	{ name: "init", description: "Initialize project guidance file." },
	{ name: "pr-comments", description: "Get comments from a pull request." },
	{ name: "context", description: "Visualize current context usage." },
	{ name: "cost", description: "Show session cost and duration." },
	{ name: "release-notes", description: "View release notes." },
];

const CODEX_DEFAULT_COMMANDS: RuntimeSlashCommandDescription[] = [
	{ name: "compact", description: "Compact conversation context." },
	{ name: "init", description: "Create AGENTS.md with guidance." },
	{ name: "status", description: "Show session status and token usage." },
	{ name: "mcp", description: "List configured MCP tools." },
];

const GEMINI_DEFAULT_COMMANDS: RuntimeSlashCommandDescription[] = [
	{ name: "help", description: "Show available commands." },
];

const OPENCODE_DEFAULT_COMMANDS: RuntimeSlashCommandDescription[] = [
	{ name: "compact", description: "Compact the current session." },
	{ name: "commands", description: "Show available commands." },
	{ name: "models", description: "List models." },
	{ name: "agents", description: "List agents." },
	{ name: "status", description: "Show current session status." },
	{ name: "mcp", description: "Show MCP status." },
];

function normalizeSlashName(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) {
		return "";
	}
	return trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
}

function withSlashPrefix(name: string): string {
	return name.startsWith("/") ? name : `/${name}`;
}

function dedupeCommands(commands: RuntimeSlashCommandDescription[]): RuntimeSlashCommandDescription[] {
	const next: RuntimeSlashCommandDescription[] = [];
	const seen = new Set<string>();
	for (const command of commands) {
		const normalizedName = normalizeSlashName(command.name).toLowerCase();
		if (!normalizedName || seen.has(normalizedName)) {
			continue;
		}
		seen.add(normalizedName);
		next.push({
			name: normalizedName,
			description: command.description ?? null,
		});
	}
	return next;
}

function inferCommandFamily(command: ResolvedAgentCommand): CommandFamily {
	if (command.agentId === "claude") {
		return "claude";
	}
	if (command.agentId === "codex") {
		return "codex";
	}
	if (command.agentId === "gemini") {
		return "gemini";
	}
	if (command.agentId === "opencode") {
		return "opencode";
	}
	const binaryName = basename(command.binary).toLowerCase();
	if (binaryName.includes("claude")) {
		return "claude";
	}
	if (binaryName.includes("codex")) {
		return "codex";
	}
	if (binaryName.includes("gemini")) {
		return "gemini";
	}
	if (binaryName.includes("opencode")) {
		return "opencode";
	}
	return "unknown";
}

function getDefaultCommands(family: CommandFamily): RuntimeSlashCommandDescription[] {
	if (family === "claude") {
		return CLAUDE_DEFAULT_COMMANDS;
	}
	if (family === "codex") {
		return CODEX_DEFAULT_COMMANDS;
	}
	if (family === "gemini") {
		return GEMINI_DEFAULT_COMMANDS;
	}
	if (family === "opencode") {
		return OPENCODE_DEFAULT_COMMANDS;
	}
	return [{ name: "help", description: "Show available commands." }];
}

function getCachedCommands(cacheKey: string): SlashCommandCacheEntry | null {
	const cached = slashCommandCache.get(cacheKey);
	if (!cached) {
		return null;
	}
	if (cached.expiresAt <= Date.now()) {
		slashCommandCache.delete(cacheKey);
		return null;
	}
	return cached;
}

function setCachedCommands(cacheKey: string, commands: RuntimeSlashCommandDescription[], error: string | null): void {
	slashCommandCache.set(cacheKey, {
		expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
		commands,
		error,
	});
}

function getRecordField(record: Record<string, unknown>, key: string): unknown {
	if (Object.hasOwn(record, key)) {
		return record[key];
	}
	return undefined;
}

function parseClaudeSlashCommandsFromOutput(stdout: string): string[] {
	const slashCommandNames = new Set<string>();
	for (const rawLine of stdout.split(/\r?\n/g)) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}
		try {
			const parsed = JSON.parse(line) as unknown;
			if (!parsed || typeof parsed !== "object") {
				continue;
			}
			const record = parsed as Record<string, unknown>;
			const subtypeValue = getRecordField(record, "subtype");
			const subtype =
				typeof subtypeValue === "string"
					? subtypeValue
					: (() => {
							const message = getRecordField(record, "message");
							if (!message || typeof message !== "object") {
								return null;
							}
							const messageSubtype = getRecordField(message as Record<string, unknown>, "subtype");
							return typeof messageSubtype === "string" ? messageSubtype : null;
						})();
			if (subtype !== "init") {
				continue;
			}
			const commandsValue = getRecordField(record, "slash_commands");
			if (!Array.isArray(commandsValue)) {
				continue;
			}
			for (const value of commandsValue) {
				if (typeof value !== "string") {
					continue;
				}
				const normalized = normalizeSlashName(value);
				if (!normalized) {
					continue;
				}
				slashCommandNames.add(normalized);
			}
		} catch {
			// Ignore non-JSON lines.
		}
	}
	return [...slashCommandNames];
}

async function discoverClaudeCommands(
	command: ResolvedAgentCommand,
	cwd: string,
): Promise<{ commands: RuntimeSlashCommandDescription[]; error: string | null }> {
	const discoveryArgs = [
		...command.args,
		"-p",
		"--verbose",
		"--output-format=stream-json",
		"--max-turns",
		"1",
		"--",
		"/",
	];
	try {
		const { stdout } = await execFileAsync(command.binary, discoveryArgs, {
			cwd,
			encoding: "utf8",
			timeout: DISCOVERY_TIMEOUT_MS,
			maxBuffer: DISCOVERY_MAX_BUFFER_BYTES,
		});
		const discovered = parseClaudeSlashCommandsFromOutput(stdout);
		return {
			commands: discovered.map((name) => ({ name, description: null })),
			error: null,
		};
	} catch (error) {
		const errorRecord = error as { stdout?: string; stderr?: string; message?: string };
		const fallbackOutput = typeof errorRecord.stdout === "string" ? errorRecord.stdout : "";
		const discovered = parseClaudeSlashCommandsFromOutput(fallbackOutput);
		const stderr = typeof errorRecord.stderr === "string" ? errorRecord.stderr.trim() : "";
		const message =
			stderr ||
			(typeof errorRecord.message === "string" && errorRecord.message.trim()
				? errorRecord.message.trim()
				: "Claude slash command discovery failed.");
		return {
			commands: discovered.map((name) => ({ name, description: null })),
			error: discovered.length > 0 ? null : message,
		};
	}
}

function parseSlashNamesFromText(text: string): string[] {
	const names = new Set<string>();
	for (const rawLine of text.split(/\r?\n/g)) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}
		const explicitMatch = /^[-*]\s+`?\/([a-z0-9][a-z0-9-]*)`?/i.exec(line);
		if (explicitMatch?.[1]) {
			names.add(explicitMatch[1].toLowerCase());
		}
	}
	return [...names];
}

async function discoverOpenCodeCommands(
	command: ResolvedAgentCommand,
	cwd: string,
): Promise<{ commands: RuntimeSlashCommandDescription[]; error: string | null }> {
	try {
		const { stdout, stderr } = await execFileAsync(command.binary, [...command.args, "run", "/commands"], {
			cwd,
			encoding: "utf8",
			timeout: DISCOVERY_TIMEOUT_MS,
			maxBuffer: DISCOVERY_MAX_BUFFER_BYTES,
		});
		const discoveredNames = parseSlashNamesFromText(`${stdout}\n${stderr}`);
		return {
			commands: discoveredNames.map((name) => ({ name, description: null })),
			error: null,
		};
	} catch (error) {
		const errorRecord = error as { stdout?: string; stderr?: string; message?: string };
		const fallbackOutput = `${typeof errorRecord.stdout === "string" ? errorRecord.stdout : ""}\n${
			typeof errorRecord.stderr === "string" ? errorRecord.stderr : ""
		}`;
		const discoveredNames = parseSlashNamesFromText(fallbackOutput);
		const message =
			typeof errorRecord.message === "string" && errorRecord.message.trim()
				? errorRecord.message.trim()
				: "OpenCode slash command discovery failed.";
		return {
			commands: discoveredNames.map((name) => ({ name, description: null })),
			error: discoveredNames.length > 0 ? null : message,
		};
	}
}

export async function discoverRuntimeSlashCommands(
	command: ResolvedAgentCommand,
	cwd: string,
): Promise<{ commands: RuntimeSlashCommandDescription[]; error: string | null }> {
	const family = inferCommandFamily(command);
	const cacheKey = [family, cwd, command.binary, ...command.args].join("\u0001");
	const cached = getCachedCommands(cacheKey);
	if (cached) {
		return {
			commands: cached.commands,
			error: cached.error,
		};
	}

	const defaults = getDefaultCommands(family);
	let dynamic: RuntimeSlashCommandDescription[] = [];
	let error: string | null = null;

	if (family === "claude") {
		const discovered = await discoverClaudeCommands(command, cwd);
		dynamic = discovered.commands;
		error = discovered.error;
	}
	if (family === "opencode") {
		const discovered = await discoverOpenCodeCommands(command, cwd);
		dynamic = discovered.commands;
		error = discovered.error;
	}

	const merged = dedupeCommands([...dynamic, ...defaults]).map((commandItem) => ({
		name: withSlashPrefix(commandItem.name),
		description: commandItem.description,
	}));
	setCachedCommands(cacheKey, merged, error);
	return {
		commands: merged,
		error,
	};
}
