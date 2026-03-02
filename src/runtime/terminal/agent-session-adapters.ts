import { access, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { RuntimeAgentId, RuntimeTaskSessionSummary } from "../api-contract.js";
import { buildKanbananaCommandParts } from "../kanbanana-command.js";
import { stripAnsi } from "./output-utils.js";
import type { SessionTransitionEvent } from "./session-state-machine.js";

export interface AgentAdapterLaunchInput {
	taskId: string;
	agentId: RuntimeAgentId;
	args: string[];
	cwd: string;
	prompt: string;
	startInPlanMode?: boolean;
	env?: Record<string, string | undefined>;
	serverPort?: number;
	workspaceId?: string;
}

export type AgentOutputTransitionDetector = (
	data: string,
	summary: RuntimeTaskSessionSummary,
) => SessionTransitionEvent | null;

export interface PreparedAgentLaunch {
	args: string[];
	env: Record<string, string | undefined>;
	writesPromptInternally: boolean;
	cleanup?: () => Promise<void>;
	detectOutputTransition?: AgentOutputTransitionDetector;
}

interface HookContext {
	taskId: string;
	serverPort: number;
}

interface SessionTempDir {
	dir: string;
	cleanup: () => Promise<void>;
}

interface AgentSessionAdapter {
	prepare(input: AgentAdapterLaunchInput): Promise<PreparedAgentLaunch>;
}

function escapeForTemplateLiteral(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll("`", "\\`");
}

function shellQuote(value: string): string {
	if (process.platform === "win32") {
		return `"${value.replaceAll('"', '""')}"`;
	}
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function resolveHookContext(input: AgentAdapterLaunchInput): HookContext | null {
	const serverPort = input.serverPort;
	if (typeof serverPort !== "number" || !Number.isInteger(serverPort) || serverPort < 1) {
		return null;
	}
	return {
		taskId: input.taskId,
		serverPort,
	};
}

function buildHookCommand(context: HookContext, event: "review" | "inprogress"): string {
	const parts = buildKanbananaCommandParts([
		"hooks",
		"ingest",
		"--task-id",
		context.taskId,
		"--event",
		event,
		"--port",
		String(context.serverPort),
	]);
	return parts.map(shellQuote).join(" ");
}

async function createSessionTempDir(input: AgentAdapterLaunchInput, scope: string): Promise<SessionTempDir> {
	const workspaceId = input.workspaceId ?? "default";
	const dir = join(tmpdir(), "kanbanana-hooks", workspaceId, `${scope}-${input.taskId}-${process.pid}-${Date.now()}`);
	await mkdir(dir, { recursive: true });
	return {
		dir,
		cleanup: async () => {
			try {
				await rm(dir, { recursive: true, force: true });
			} catch {
				// Best effort cleanup.
			}
		},
	};
}

function withPrompt(args: string[], prompt: string, mode: "append" | "flag", flag?: string): PreparedAgentLaunch {
	const trimmed = prompt.trim();
	if (!trimmed) {
		return {
			args,
			env: {},
			writesPromptInternally: false,
		};
	}
	if (mode === "flag" && flag) {
		args.push(flag, trimmed);
	} else {
		args.push(trimmed);
	}
	return {
		args,
		env: {},
		writesPromptInternally: true,
	};
}

const claudeAdapter: AgentSessionAdapter = {
	async prepare(input) {
		const args = [...input.args];
		const env: Record<string, string | undefined> = {};
		let cleanup: (() => Promise<void>) | undefined;
		if (input.startInPlanMode) {
			const withoutImmediateBypass = args.filter((arg) => arg !== "--dangerously-skip-permissions");
			args.length = 0;
			args.push(...withoutImmediateBypass);
			if (!args.includes("--allow-dangerously-skip-permissions")) {
				args.push("--allow-dangerously-skip-permissions");
			}
			args.push("--permission-mode", "plan");
		}

		const hooks = resolveHookContext(input);
		if (hooks) {
			const temp = await createSessionTempDir(input, "claude");
			cleanup = temp.cleanup;
			const settingsPath = join(temp.dir, "settings.json");
			const hooksSettings = {
				hooks: {
					Stop: [{ hooks: [{ type: "command", command: buildHookCommand(hooks, "review") }] }],
					Notification: [
						{
							matcher: "permission_prompt",
							hooks: [{ type: "command", command: buildHookCommand(hooks, "review") }],
						},
					],
					UserPromptSubmit: [{ hooks: [{ type: "command", command: buildHookCommand(hooks, "inprogress") }] }],
				},
			};
			await writeFile(settingsPath, JSON.stringify(hooksSettings, null, 2), "utf8");
			args.push("--settings", settingsPath);
		}

		const withPromptLaunch = withPrompt(args, input.prompt, "append");
		return {
			...withPromptLaunch,
			env: {
				...withPromptLaunch.env,
				...env,
			},
			cleanup,
		};
	},
};

function codexPromptDetector(data: string, summary: RuntimeTaskSessionSummary): SessionTransitionEvent | null {
	if (summary.state !== "awaiting_review") {
		return null;
	}
	if (summary.reviewReason !== "attention" && summary.reviewReason !== "hook") {
		return null;
	}
	const stripped = stripAnsi(data);
	if (/(?:^|\n)\s*›/.test(stripped)) {
		return { type: "agent.prompt-ready" };
	}
	return null;
}

const codexAdapter: AgentSessionAdapter = {
	async prepare(input) {
		const args = [...input.args];
		const env: Record<string, string | undefined> = {};
		let cleanup: (() => Promise<void>) | undefined;

		const hooks = resolveHookContext(input);
		if (hooks) {
			if (process.platform === "win32") {
				const notifyArray = JSON.stringify(
					buildKanbananaCommandParts([
						"hooks",
						"ingest",
						"--task-id",
						hooks.taskId,
						"--event",
						"review",
						"--port",
						String(hooks.serverPort),
					]),
				);
				args.push("-c", `notify=${notifyArray}`);
			} else {
				const temp = await createSessionTempDir(input, "codex");
				cleanup = temp.cleanup;
				const scriptPath = join(temp.dir, "notify-review.sh");
				const scriptBody = `#!/bin/sh\n${buildHookCommand(hooks, "review")}\n`;
				await writeFile(scriptPath, scriptBody, "utf8");
				await chmod(scriptPath, 0o755);
				const notifyArray = JSON.stringify(["/bin/sh", scriptPath]);
				args.push("-c", `notify=${notifyArray}`);
			}
		}

		const trimmed = input.prompt.trim();
		if (trimmed) {
			const initialPrompt = input.startInPlanMode ? `/plan\n${trimmed}` : trimmed;
			args.push(initialPrompt);
			return {
				args,
				env,
				writesPromptInternally: true,
				cleanup,
				detectOutputTransition: codexPromptDetector,
			};
		}

		return {
			args,
			env,
			writesPromptInternally: false,
			cleanup,
			detectOutputTransition: codexPromptDetector,
		};
	},
};

const geminiAdapter: AgentSessionAdapter = {
	async prepare(input) {
		const args = [...input.args];
		const env: Record<string, string | undefined> = {};
		let cleanup: (() => Promise<void>) | undefined;

		if (input.startInPlanMode) {
			args.push("--approval-mode=plan");
		}

		const hooks = resolveHookContext(input);
		if (hooks) {
			const temp = await createSessionTempDir(input, "gemini");
			cleanup = temp.cleanup;
			const configPath = join(temp.dir, "settings.json");
			const config = {
				hooks: {
					AfterAgent: [{ hooks: [{ type: "command", command: buildHookCommand(hooks, "review") }] }],
					Notification: [{ hooks: [{ type: "command", command: buildHookCommand(hooks, "review") }] }],
					BeforeAgent: [{ hooks: [{ type: "command", command: buildHookCommand(hooks, "inprogress") }] }],
				},
			};
			await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
			env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = configPath;
		}

		const trimmed = input.prompt.trim();
		if (trimmed) {
			args.push("-i", trimmed);
			return {
				args,
				env,
				writesPromptInternally: true,
				cleanup,
			};
		}

		return {
			args,
			env,
			writesPromptInternally: false,
			cleanup,
		};
	},
};

async function resolveOpenCodeBaseConfigPath(explicitPath: string | undefined): Promise<string | null> {
	const candidates: string[] = [];
	const explicit = explicitPath?.trim();
	if (explicit) {
		candidates.push(explicit);
	}
	const processExplicit = process.env.OPENCODE_CONFIG?.trim();
	if (processExplicit) {
		candidates.push(processExplicit);
	}
	candidates.push(
		join(homedir(), ".config", "opencode", "config.json"),
		join(homedir(), ".config", "opencode", "opencode.jsonc"),
		join(homedir(), ".config", "opencode", "opencode.json"),
		join(homedir(), ".opencode", "opencode.jsonc"),
		join(homedir(), ".opencode", "opencode.json"),
	);
	for (const candidate of candidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Keep searching.
		}
	}
	return null;
}

function hasOpenCodeModelArg(args: string[]): boolean {
	for (const arg of args) {
		if (arg === "--model" || arg === "-m") {
			return true;
		}
		if (arg.startsWith("--model=") || arg.startsWith("-m=")) {
			return true;
		}
	}
	return false;
}

function hasOpenCodeAgentArg(args: string[]): boolean {
	for (const arg of args) {
		if (arg === "--agent") {
			return true;
		}
		if (arg.startsWith("--agent=")) {
			return true;
		}
	}
	return false;
}

function normalizeOpenCodeModel(providerId: string, modelId: string): string {
	if (modelId.startsWith(`${providerId}/`)) {
		return modelId;
	}
	return `${providerId}/${modelId}`;
}

function stripJsonComments(input: string): string {
	let output = "";
	let inString = false;
	let escaped = false;
	let inLineComment = false;
	let inBlockComment = false;

	for (let i = 0; i < input.length; i += 1) {
		const current = input[i];
		const next = i + 1 < input.length ? input[i + 1] : "";

		if (inLineComment) {
			if (current === "\n") {
				inLineComment = false;
				output += current;
			}
			continue;
		}
		if (inBlockComment) {
			if (current === "*" && next === "/") {
				inBlockComment = false;
				i += 1;
			}
			continue;
		}
		if (!inString && current === "/" && next === "/") {
			inLineComment = true;
			i += 1;
			continue;
		}
		if (!inString && current === "/" && next === "*") {
			inBlockComment = true;
			i += 1;
			continue;
		}

		output += current;
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (current === "\\") {
				escaped = true;
			} else if (current === '"') {
				inString = false;
			}
			continue;
		}
		if (current === '"') {
			inString = true;
		}
	}
	return output;
}

function tryExtractOpenCodeModelFromConfig(rawConfig: string): string | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawConfig);
	} catch {
		try {
			parsed = JSON.parse(stripJsonComments(rawConfig));
		} catch {
			return null;
		}
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}
	const root = parsed as Record<string, unknown>;

	const directModel = root.model;
	if (typeof directModel === "string" && directModel.trim()) {
		return directModel.trim();
	}

	const mode = root.mode;
	if (mode && typeof mode === "object" && !Array.isArray(mode)) {
		const build = (mode as Record<string, unknown>).build;
		if (build && typeof build === "object" && !Array.isArray(build)) {
			const model = (build as Record<string, unknown>).model;
			if (typeof model === "string" && model.trim()) {
				return model.trim();
			}
		}
	}

	const agent = root.agent;
	if (agent && typeof agent === "object" && !Array.isArray(agent)) {
		const build = (agent as Record<string, unknown>).build;
		if (build && typeof build === "object" && !Array.isArray(build)) {
			const model = (build as Record<string, unknown>).model;
			if (typeof model === "string" && model.trim()) {
				return model.trim();
			}
		}
	}

	return null;
}

async function resolveOpenCodePreferredModelArg(configPath: string | null): Promise<string | null> {
	if (configPath) {
		try {
			const rawConfig = await readFile(configPath, "utf8");
			const modelFromConfig = tryExtractOpenCodeModelFromConfig(rawConfig);
			if (modelFromConfig) {
				return modelFromConfig;
			}
		} catch {
			// Fall through to state-based fallback.
		}
	}

	const modelStatePath = join(homedir(), ".local", "state", "opencode", "model.json");
	const authPath = join(homedir(), ".local", "share", "opencode", "auth.json");

	let recentModels: Array<{ providerID?: unknown; modelID?: unknown }> = [];
	try {
		const raw = await readFile(modelStatePath, "utf8");
		const parsed = JSON.parse(raw) as { recent?: Array<{ providerID?: unknown; modelID?: unknown }> };
		if (Array.isArray(parsed.recent)) {
			recentModels = parsed.recent;
		}
	} catch {
		return null;
	}

	const configuredProviders = new Set<string>();
	try {
		const raw = await readFile(authPath, "utf8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		for (const [provider, value] of Object.entries(parsed)) {
			if (!value || typeof value !== "object" || Array.isArray(value)) {
				continue;
			}
			const key = (value as Record<string, unknown>).key;
			if (typeof key === "string" && key.trim()) {
				configuredProviders.add(provider);
			}
		}
	} catch {
		// If auth cannot be read, fall back to recent model order.
	}

	const candidates: Array<{ providerId: string; model: string }> = [];
	for (const entry of recentModels) {
		const providerId = typeof entry.providerID === "string" ? entry.providerID.trim() : "";
		const modelId = typeof entry.modelID === "string" ? entry.modelID.trim() : "";
		if (!providerId || !modelId) {
			continue;
		}
		candidates.push({ providerId, model: normalizeOpenCodeModel(providerId, modelId) });
	}
	if (candidates.length === 0) {
		return null;
	}

	const preferredProviderOrder = ["openrouter", "anthropic", "openai", "opencode", "google", "amazon-bedrock"];
	for (const providerId of preferredProviderOrder) {
		const match = candidates.find((candidate) => candidate.providerId === providerId);
		if (!match) {
			continue;
		}
		if (configuredProviders.size === 0 || configuredProviders.has(providerId)) {
			return match.model;
		}
	}

	const configuredMatch = candidates.find((candidate) => configuredProviders.has(candidate.providerId));
	if (configuredMatch) {
		return configuredMatch.model;
	}

	return candidates[0].model;
}

const opencodeAdapter: AgentSessionAdapter = {
	async prepare(input) {
		const args = [...input.args];
		const env: Record<string, string | undefined> = {};
		let cleanup: (() => Promise<void>) | undefined;
		const baseConfigPath = await resolveOpenCodeBaseConfigPath(input.env?.OPENCODE_CONFIG);

		if (input.startInPlanMode) {
			env.OPENCODE_EXPERIMENTAL_PLAN_MODE = "true";
			if (!hasOpenCodeAgentArg(args)) {
				args.push("--agent", "plan");
			}
		}

		const hooks = resolveHookContext(input);
		if (hooks) {
			const temp = await createSessionTempDir(input, "opencode");
			cleanup = temp.cleanup;
			const pluginPath = join(temp.dir, `kanbanana-${input.taskId}.js`);
			const configPath = join(temp.dir, "opencode.json");

			const reviewCmd = escapeForTemplateLiteral(buildHookCommand(hooks, "review"));
			const inprogressCmd = escapeForTemplateLiteral(buildHookCommand(hooks, "inprogress"));
			const pluginContent = `export const KanbananaPlugin = async ({ $ }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        try {
          await $\`${reviewCmd}\`;
        } catch {
          // Best effort: hook errors should never break OpenCode event handling.
        }
      }
      if (event.type.startsWith("session.") && event.type !== "session.idle") {
        const statusType = event?.properties?.status?.type;
        if (statusType === "idle") {
          return;
        }
        try {
          await $\`${inprogressCmd}\`;
        } catch {
          // Best effort: hook errors should never break OpenCode event handling.
        }
      }
    },
  };
};
`;
			await writeFile(pluginPath, pluginContent, "utf8");
			const pluginFileUrl = pathToFileURL(pluginPath).href;
			const config = {
				plugin: [pluginFileUrl],
			};
			await writeFile(configPath, JSON.stringify(config), "utf8");
			env.OPENCODE_CONFIG = configPath;
		}

		// Workaround: with --prompt, OpenCode can pick an unexpected provider/model.
		// Explicitly pass the user's preferred model so prompt runs stay on their usual provider.
		if (!hasOpenCodeModelArg(args)) {
			const preferredModel = await resolveOpenCodePreferredModelArg(baseConfigPath);
			if (preferredModel) {
				args.push("--model", preferredModel);
			}
		}

		const trimmed = input.prompt.trim();
		if (trimmed) {
			args.push("--prompt", trimmed);
			return {
				args,
				env,
				writesPromptInternally: true,
				cleanup,
			};
		}

		return {
			args,
			env,
			writesPromptInternally: false,
			cleanup,
		};
	},
};

const clineAdapter: AgentSessionAdapter = {
	async prepare(input) {
		const args = [...input.args];
		const env: Record<string, string | undefined> = {};

		if (input.startInPlanMode) {
			args.push("--plan");
		}

		const withPromptLaunch = withPrompt(args, input.prompt, "append");
		return {
			...withPromptLaunch,
			env: {
				...withPromptLaunch.env,
				...env,
			},
		};
	},
};

const ADAPTERS: Record<RuntimeAgentId, AgentSessionAdapter> = {
	claude: claudeAdapter,
	codex: codexAdapter,
	gemini: geminiAdapter,
	opencode: opencodeAdapter,
	cline: clineAdapter,
};

export async function prepareAgentLaunch(input: AgentAdapterLaunchInput): Promise<PreparedAgentLaunch> {
	return ADAPTERS[input.agentId].prepare(input);
}
