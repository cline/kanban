import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import type { RuntimeAgentId, RuntimeHookEvent, RuntimeTaskSessionSummary } from "../core/api-contract.js";
import { buildKanbanCommandParts } from "../core/kanban-command.js";
import { getRuntimeHomePath } from "../state/workspace-state.js";
import { createHookRuntimeEnv } from "./hook-runtime-context.js";
import { stripAnsi } from "./output-utils.js";
import type { SessionTransitionEvent } from "./session-state-machine.js";

export interface AgentAdapterLaunchInput {
	taskId: string;
	agentId: RuntimeAgentId;
	binary?: string;
	args: string[];
	cwd: string;
	prompt: string;
	startInPlanMode?: boolean;
	resumeFromTrash?: boolean;
	env?: Record<string, string | undefined>;
	workspaceId?: string;
}

export type AgentOutputTransitionDetector = (
	data: string,
	summary: RuntimeTaskSessionSummary,
) => SessionTransitionEvent | null;

export interface PreparedAgentLaunch {
	binary?: string;
	args: string[];
	env: Record<string, string | undefined>;
	writesPromptInternally: boolean;
	cleanup?: () => Promise<void>;
	detectOutputTransition?: AgentOutputTransitionDetector;
}

interface HookContext {
	taskId: string;
	workspaceId: string;
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

function powerShellQuote(value: string): string {
	return `"${value.replaceAll("`", "``").replaceAll('"', '`"')}"`;
}

function resolveHookContext(input: AgentAdapterLaunchInput): HookContext | null {
	const workspaceId = input.workspaceId?.trim();
	if (!workspaceId) {
		return null;
	}
	return {
		taskId: input.taskId,
		workspaceId,
	};
}

function buildHookCommand(event: RuntimeHookEvent): string {
	const parts = buildHooksCommandParts(["ingest", "--event", event]);
	return parts.map(shellQuote).join(" ");
}

function buildHooksCommandParts(args: string[]): string[] {
	return buildKanbanCommandParts(["hooks", ...args]);
}

function buildHooksCommand(args: string[]): string {
	return buildHooksCommandParts(args).map(shellQuote).join(" ");
}

function hasCliOption(args: string[], optionName: string): boolean {
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === optionName || arg.startsWith(`${optionName}=`)) {
			return true;
		}
	}
	return false;
}

function getClineHookScriptPath(
	hooksDir: string,
	hookName: "Notification" | "TaskComplete" | "UserPromptSubmit",
): string {
	if (process.platform === "win32") {
		return join(hooksDir, `${hookName}.ps1`);
	}
	return join(hooksDir, hookName);
}

function buildClineHookScriptContent(event: RuntimeHookEvent): string {
	const commandParts = buildHooksCommandParts(["notify", "--event", event]);
	if (process.platform === "win32") {
		const command = commandParts.map(powerShellQuote).join(" ");
		return `try {
  & ${command} | Out-Null
} catch {
}
Write-Output '{"cancel":false}'
exit 0
`;
	}
	const command = commandParts.map(shellQuote).join(" ");
	return `#!/usr/bin/env bash
${command} >/dev/null 2>&1 || true
echo '{"cancel":false}'
`;
}

function buildClineNotificationHookScriptContent(): string {
	const commandParts = buildHooksCommandParts(["notify", "--event", "to_review"]);
	if (process.platform === "win32") {
		const command = commandParts.map(powerShellQuote).join(" ");
		return `$inputText = [Console]::In.ReadToEnd()
if ($inputText -match '"event"\\s*:\\s*"(user_attention|task_complete)"') {
  try {
    & ${command} | Out-Null
  } catch {
  }
}
Write-Output '{"cancel":false}'
exit 0
`;
	}
	const command = commandParts.map(shellQuote).join(" ");
	return `#!/usr/bin/env bash
INPUT="$(cat || true)"
if printf '%s' "$INPUT" | grep -Eq '"event"[[:space:]]*:[[:space:]]*"(user_attention|task_complete)"'; then
  ${command} >/dev/null 2>&1 || true
fi
echo '{"cancel":false}'
`;
}

function buildOpenCodePluginContent(reviewCommand: string, toInProgressCommand: string): string {
	const reviewCmd = escapeForTemplateLiteral(reviewCommand);
	const toInProgressCmd = escapeForTemplateLiteral(toInProgressCommand);
	return `export const KanbanPlugin = async ({ $, client }) => {
  if (globalThis.__kanbanOpencodePluginV2) return {};
  globalThis.__kanbanOpencodePluginV2 = true;

  if (!process?.env?.KANBAN_HOOK_TASK_ID) return {};

  let currentState = "idle";
  let rootSessionID = null;
  const childSessionCache = new Map();

  const notifyReview = async () => {
    try {
      await $\`${reviewCmd}\`;
    } catch {
      // Best effort: hook errors should never break OpenCode event handling.
    }
  };

  const notifyInprogress = async () => {
    try {
      await $\`${toInProgressCmd}\`;
    } catch {
      // Best effort: hook errors should never break OpenCode event handling.
    }
  };

  const isChildSession = async (sessionID) => {
    if (!sessionID) return true;
    if (!client?.session?.list) return true;
    if (childSessionCache.has(sessionID)) {
      return childSessionCache.get(sessionID);
    }
    try {
      const sessions = await client.session.list();
      const session = sessions.data?.find((candidate) => candidate.id === sessionID);
      const isChild = !!session?.parentID;
      childSessionCache.set(sessionID, isChild);
      return isChild;
    } catch {
      return true;
    }
  };

  const handleBusy = async (sessionID) => {
    if (!rootSessionID) {
      rootSessionID = sessionID;
    }
    if (sessionID !== rootSessionID) {
      return;
    }
    if (currentState === "idle") {
      currentState = "busy";
      await notifyInprogress();
    }
  };

  const handleReview = async (sessionID) => {
    if (rootSessionID && sessionID !== rootSessionID) {
      return;
    }
    if (currentState === "busy") {
      currentState = "idle";
      await notifyReview();
      rootSessionID = null;
    }
  };

  return {
    event: async ({ event }) => {
      const sessionID = event.properties?.sessionID;
      if (await isChildSession(sessionID)) {
        return;
      }

      if (event.type === "session.status") {
        const status = event.properties?.status;
        if (status?.type === "busy") {
          await handleBusy(sessionID);
        } else if (status?.type === "idle") {
          await handleReview(sessionID);
        }
      }

      if (event.type === "session.busy") {
        await handleBusy(sessionID);
      }
      if (event.type === "session.idle" || event.type === "session.error") {
        await handleReview(sessionID);
      }
    },
    "permission.ask": async (_permission, output) => {
      if (output?.status === "ask") {
        await notifyReview();
        currentState = "idle";
      }
    },
  };
};
`;
}

function getHookAgentDirectory(agentId: RuntimeAgentId): string {
	return join(getRuntimeHomePath(), "hooks", agentId);
}

async function readFileIfExists(filePath: string): Promise<string | null> {
	try {
		return await readFile(filePath, "utf8");
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

async function ensureTextFile(filePath: string, content: string, executable = false): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });
	const existing = await readFileIfExists(filePath);
	if (existing !== content) {
		await writeFile(filePath, content, "utf8");
	}
	if (executable) {
		await chmod(filePath, 0o755);
	}
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
		if (input.resumeFromTrash && !hasCliOption(args, "--continue")) {
			args.push("--continue");
		}
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
			const settingsPath = join(getHookAgentDirectory("claude"), "settings.json");
			const hooksSettings = {
				hooks: {
					Stop: [{ hooks: [{ type: "command", command: buildHookCommand("to_review") }] }],
					PermissionRequest: [
						{ matcher: "*", hooks: [{ type: "command", command: buildHookCommand("to_review") }] },
					],
					PostToolUse: [
						{ matcher: "*", hooks: [{ type: "command", command: buildHookCommand("to_in_progress") }] },
					],
					PostToolUseFailure: [
						{ matcher: "*", hooks: [{ type: "command", command: buildHookCommand("to_in_progress") }] },
					],
					Notification: [
						{
							matcher: "permission_prompt",
							hooks: [{ type: "command", command: buildHookCommand("to_review") }],
						},
					],
					UserPromptSubmit: [{ hooks: [{ type: "command", command: buildHookCommand("to_in_progress") }] }],
				},
			};
			await ensureTextFile(settingsPath, JSON.stringify(hooksSettings, null, 2));
			args.push("--settings", settingsPath);
			Object.assign(
				env,
				createHookRuntimeEnv({
					taskId: hooks.taskId,
					workspaceId: hooks.workspaceId,
				}),
			);
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
		const codexArgs = [...input.args];
		const env: Record<string, string | undefined> = {};
		let binary = input.binary;

		if (input.resumeFromTrash) {
			if (!codexArgs.includes("resume")) {
				codexArgs.push("resume");
			}
			if (!hasCliOption(codexArgs, "--last")) {
				codexArgs.push("--last");
			}
		}

		const hooks = resolveHookContext(input);
		if (hooks) {
			Object.assign(
				env,
				createHookRuntimeEnv({
					taskId: hooks.taskId,
					workspaceId: hooks.workspaceId,
				}),
			);
		}

		const trimmed = input.prompt.trim();
		if (trimmed) {
			const initialPrompt = input.startInPlanMode ? `/plan\n${trimmed}` : trimmed;
			codexArgs.push(initialPrompt);
		}

		if (hooks) {
			const wrapperParts = buildHooksCommandParts([
				"codex-wrapper",
				"--real-binary",
				input.binary ?? "codex",
				"--",
				...codexArgs,
			]);
			binary = wrapperParts[0];
			const args = wrapperParts.slice(1);
			return {
				binary,
				args,
				env,
				writesPromptInternally: Boolean(trimmed),
				detectOutputTransition: codexPromptDetector,
			};
		}

		return {
			binary,
			args: codexArgs,
			env,
			writesPromptInternally: Boolean(trimmed),
			detectOutputTransition: codexPromptDetector,
		};
	},
};

const geminiAdapter: AgentSessionAdapter = {
	async prepare(input) {
		const args = [...input.args];
		const env: Record<string, string | undefined> = {};

		if (input.resumeFromTrash && !hasCliOption(args, "--resume")) {
			args.push("--resume", "latest");
		}

		if (input.startInPlanMode) {
			args.push("--approval-mode=plan");
		}

		const hooks = resolveHookContext(input);
		if (hooks) {
			const configPath = join(getHookAgentDirectory("gemini"), "settings.json");
			const geminiHookCommand = buildHooksCommand(["gemini-hook"]);

			const config = {
				hooks: {
					AfterTool: [
						{
							hooks: [{ type: "command", command: geminiHookCommand }],
						},
					],
					AfterAgent: [
						{
							hooks: [{ type: "command", command: geminiHookCommand }],
						},
					],
					BeforeAgent: [
						{
							hooks: [{ type: "command", command: geminiHookCommand }],
						},
					],
				},
			};
			await ensureTextFile(configPath, JSON.stringify(config, null, 2));
			Object.assign(
				env,
				createHookRuntimeEnv({
					taskId: hooks.taskId,
					workspaceId: hooks.workspaceId,
				}),
			);
			env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = configPath;
		}

		const trimmed = input.prompt.trim();
		if (trimmed) {
			args.push("-i", trimmed);
			return {
				args,
				env,
				writesPromptInternally: true,
			};
		}

		return {
			args,
			env,
			writesPromptInternally: false,
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
		const baseConfigPath = await resolveOpenCodeBaseConfigPath(input.env?.OPENCODE_CONFIG);
		if (input.resumeFromTrash && !hasCliOption(args, "--continue")) {
			args.push("--continue");
		}

		if (input.startInPlanMode) {
			env.OPENCODE_EXPERIMENTAL_PLAN_MODE = "true";
			if (!hasOpenCodeAgentArg(args)) {
				args.push("--agent", "plan");
			}
		}

		const hooks = resolveHookContext(input);
		if (hooks) {
			const pluginPath = join(getHookAgentDirectory("opencode"), "kanban.js");
			const configPath = join(getHookAgentDirectory("opencode"), "opencode.json");

			const pluginContent = buildOpenCodePluginContent(
				buildHookCommand("to_review"),
				buildHookCommand("to_in_progress"),
			);
			await ensureTextFile(pluginPath, pluginContent);
			const pluginFileUrl = pathToFileURL(pluginPath).href;
			const config = {
				plugin: [pluginFileUrl],
			};
			await ensureTextFile(configPath, JSON.stringify(config));
			Object.assign(
				env,
				createHookRuntimeEnv({
					taskId: hooks.taskId,
					workspaceId: hooks.workspaceId,
				}),
			);
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
			};
		}

		return {
			args,
			env,
			writesPromptInternally: false,
		};
	},
};

const clineAdapter: AgentSessionAdapter = {
	async prepare(input) {
		const args = [...input.args];
		const env: Record<string, string | undefined> = {};

		if (input.resumeFromTrash && !hasCliOption(args, "--continue")) {
			args.push("--continue");
		}

		if (input.startInPlanMode) {
			args.push("--plan");
		}

		const hooks = resolveHookContext(input);
		if (hooks) {
			const hooksDir = getHookAgentDirectory("cline");
			const notificationHookPath = getClineHookScriptPath(hooksDir, "Notification");
			const taskCompleteHookPath = getClineHookScriptPath(hooksDir, "TaskComplete");
			const userPromptSubmitHookPath = getClineHookScriptPath(hooksDir, "UserPromptSubmit");
			const executable = process.platform !== "win32";

			await ensureTextFile(notificationHookPath, buildClineNotificationHookScriptContent(), executable);
			await ensureTextFile(taskCompleteHookPath, buildClineHookScriptContent("to_review"), executable);
			await ensureTextFile(userPromptSubmitHookPath, buildClineHookScriptContent("to_in_progress"), executable);

			if (!hasCliOption(args, "--hooks-dir")) {
				args.push("--hooks-dir", hooksDir);
			}

			Object.assign(
				env,
				createHookRuntimeEnv({
					taskId: hooks.taskId,
					workspaceId: hooks.workspaceId,
				}),
			);
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
