import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { RuntimeAgentId, RuntimeProjectShortcut } from "../api-contract.js";

interface RuntimeGlobalConfigFileShape {
	selectedAgentId?: RuntimeAgentId;
	readyForReviewNotificationsEnabled?: boolean;
	commitLocalPromptTemplate?: string;
	commitWorktreePromptTemplate?: string;
	openPrLocalPromptTemplate?: string;
	openPrWorktreePromptTemplate?: string;
}

interface RuntimeProjectConfigFileShape {
	shortcuts?: RuntimeProjectShortcut[];
}

export interface RuntimeConfigState {
	globalConfigPath: string;
	projectConfigPath: string;
	selectedAgentId: RuntimeAgentId;
	readyForReviewNotificationsEnabled: boolean;
	shortcuts: RuntimeProjectShortcut[];
	commitLocalPromptTemplate: string;
	commitWorktreePromptTemplate: string;
	openPrLocalPromptTemplate: string;
	openPrWorktreePromptTemplate: string;
	commitLocalPromptTemplateDefault: string;
	commitWorktreePromptTemplateDefault: string;
	openPrLocalPromptTemplateDefault: string;
	openPrWorktreePromptTemplateDefault: string;
}

const RUNTIME_HOME_DIR = ".kanbanana";
const CONFIG_FILENAME = "config.json";
const PROJECT_CONFIG_DIR = ".kanbanana";
const PROJECT_CONFIG_FILENAME = "config.json";
const DEFAULT_AGENT_ID: RuntimeAgentId = "claude";
const DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED = true;
const DEFAULT_COMMIT_LOCAL_PROMPT_TEMPLATE = `Commit the changes made in this task.

1. Check git status and review what changed.
2. Stage the relevant files.
3. Write a clear commit message based on the actual diff.
4. Create the commit. Do not switch away from the current branch.
5. If there is nothing to commit, say so and stop.`;
const DEFAULT_COMMIT_WORKTREE_PROMPT_TEMPLATE = `You are in a worktree (possibly on detached HEAD). Commit these changes and get the commit onto {{base_ref}}.

1. Stage and commit the changes here (this works even on detached HEAD). Capture the commit hash.
2. Run git worktree list to find where {{base_ref}} is checked out.
3. If {{base_ref}} is checked out in another worktree at path P, run: git -C P cherry-pick <hash>
4. If {{base_ref}} is not checked out anywhere, check it out in this worktree and cherry-pick the commit onto it.
5. Resolve conflicts if they arise.
6. Report the final commit hash on {{base_ref}}.`;
const DEFAULT_OPEN_PR_LOCAL_PROMPT_TEMPLATE = `Create a pull request against {{base_ref}}.

1. If currently on {{base_ref}}, create a new branch and switch to it (uncommitted changes will carry over).
2. Commit the changes on the new branch.
3. Push the branch to origin.
4. Create the PR targeting {{base_ref}} (use gh CLI if available).
5. If PR creation is blocked, explain why and provide instructions to finish it manually.`;
const DEFAULT_OPEN_PR_WORKTREE_PROMPT_TEMPLATE = `You are in a worktree (possibly on detached HEAD). Create a pull request against {{base_ref}}.

1. If on detached HEAD, create a new branch at the current commit.
2. Commit any uncommitted changes on that branch.
3. Push the branch to origin.
4. Create the PR targeting {{base_ref}} (use gh CLI if available).
5. If PR creation is blocked, explain why and provide instructions to finish it manually.`;

function getRuntimeHomePath(): string {
	return join(homedir(), RUNTIME_HOME_DIR);
}

function normalizeAgentId(agentId: RuntimeAgentId | string | null | undefined): RuntimeAgentId {
	if (
		agentId === "claude" ||
		agentId === "codex" ||
		agentId === "gemini" ||
		agentId === "opencode" ||
		agentId === "cline"
	) {
		return agentId;
	}
	return DEFAULT_AGENT_ID;
}

function normalizeShortcut(shortcut: RuntimeProjectShortcut): RuntimeProjectShortcut | null {
	if (!shortcut || typeof shortcut !== "object") {
		return null;
	}

	const id = typeof shortcut.id === "string" ? shortcut.id.trim() : "";
	const label = typeof shortcut.label === "string" ? shortcut.label.trim() : "";
	const command = typeof shortcut.command === "string" ? shortcut.command.trim() : "";
	const icon = typeof shortcut.icon === "string" ? shortcut.icon.trim() : "";

	if (!id || !label || !command) {
		return null;
	}

	return {
		id,
		label,
		command,
		icon: icon || undefined,
	};
}

function normalizeShortcuts(shortcuts: RuntimeProjectShortcut[] | null | undefined): RuntimeProjectShortcut[] {
	if (!Array.isArray(shortcuts)) {
		return [];
	}
	const normalized: RuntimeProjectShortcut[] = [];
	for (const shortcut of shortcuts) {
		const parsed = normalizeShortcut(shortcut);
		if (parsed) {
			normalized.push(parsed);
		}
	}
	return normalized;
}

function normalizePromptTemplate(value: unknown, fallback: string): string {
	if (typeof value !== "string") {
		return fallback;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	return fallback;
}

export function getRuntimeGlobalConfigPath(): string {
	return join(getRuntimeHomePath(), CONFIG_FILENAME);
}

export function getRuntimeProjectConfigPath(cwd: string): string {
	return join(resolve(cwd), PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILENAME);
}

function toRuntimeConfigState({
	globalConfigPath,
	projectConfigPath,
	globalConfig,
	projectConfig,
}: {
	globalConfigPath: string;
	projectConfigPath: string;
	globalConfig: RuntimeGlobalConfigFileShape | null;
	projectConfig: RuntimeProjectConfigFileShape | null;
}): RuntimeConfigState {
	return {
		globalConfigPath,
		projectConfigPath,
		selectedAgentId: normalizeAgentId(globalConfig?.selectedAgentId),
		readyForReviewNotificationsEnabled: normalizeBoolean(
			globalConfig?.readyForReviewNotificationsEnabled,
			DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED,
		),
		shortcuts: normalizeShortcuts(projectConfig?.shortcuts),
		commitLocalPromptTemplate: normalizePromptTemplate(
			globalConfig?.commitLocalPromptTemplate,
			DEFAULT_COMMIT_LOCAL_PROMPT_TEMPLATE,
		),
		commitWorktreePromptTemplate: normalizePromptTemplate(
			globalConfig?.commitWorktreePromptTemplate,
			DEFAULT_COMMIT_WORKTREE_PROMPT_TEMPLATE,
		),
		openPrLocalPromptTemplate: normalizePromptTemplate(
			globalConfig?.openPrLocalPromptTemplate,
			DEFAULT_OPEN_PR_LOCAL_PROMPT_TEMPLATE,
		),
		openPrWorktreePromptTemplate: normalizePromptTemplate(
			globalConfig?.openPrWorktreePromptTemplate,
			DEFAULT_OPEN_PR_WORKTREE_PROMPT_TEMPLATE,
		),
		commitLocalPromptTemplateDefault: DEFAULT_COMMIT_LOCAL_PROMPT_TEMPLATE,
		commitWorktreePromptTemplateDefault: DEFAULT_COMMIT_WORKTREE_PROMPT_TEMPLATE,
		openPrLocalPromptTemplateDefault: DEFAULT_OPEN_PR_LOCAL_PROMPT_TEMPLATE,
		openPrWorktreePromptTemplateDefault: DEFAULT_OPEN_PR_WORKTREE_PROMPT_TEMPLATE,
	};
}

async function readRuntimeConfigFile<T>(configPath: string): Promise<T | null> {
	try {
		const raw = await readFile(configPath, "utf8");
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

async function writeRuntimeGlobalConfigFile(
	configPath: string,
	config: {
		selectedAgentId: RuntimeAgentId;
		readyForReviewNotificationsEnabled: boolean;
		commitLocalPromptTemplate: string;
		commitWorktreePromptTemplate: string;
		openPrLocalPromptTemplate: string;
		openPrWorktreePromptTemplate: string;
	},
): Promise<void> {
	await mkdir(dirname(configPath), { recursive: true });
	await writeFile(
		configPath,
		JSON.stringify(
			{
				selectedAgentId: normalizeAgentId(config.selectedAgentId),
				readyForReviewNotificationsEnabled: normalizeBoolean(
					config.readyForReviewNotificationsEnabled,
					DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED,
				),
				commitLocalPromptTemplate: normalizePromptTemplate(
					config.commitLocalPromptTemplate,
					DEFAULT_COMMIT_LOCAL_PROMPT_TEMPLATE,
				),
				commitWorktreePromptTemplate: normalizePromptTemplate(
					config.commitWorktreePromptTemplate,
					DEFAULT_COMMIT_WORKTREE_PROMPT_TEMPLATE,
				),
				openPrLocalPromptTemplate: normalizePromptTemplate(
					config.openPrLocalPromptTemplate,
					DEFAULT_OPEN_PR_LOCAL_PROMPT_TEMPLATE,
				),
				openPrWorktreePromptTemplate: normalizePromptTemplate(
					config.openPrWorktreePromptTemplate,
					DEFAULT_OPEN_PR_WORKTREE_PROMPT_TEMPLATE,
				),
			},
			null,
			2,
		),
		"utf8",
	);
}

async function writeRuntimeProjectConfigFile(
	configPath: string,
	config: { shortcuts: RuntimeProjectShortcut[] },
): Promise<void> {
	await mkdir(dirname(configPath), { recursive: true });
	await writeFile(
		configPath,
		JSON.stringify(
			{
				shortcuts: normalizeShortcuts(config.shortcuts),
			},
			null,
			2,
		),
		"utf8",
	);
}

export async function loadRuntimeConfig(cwd: string): Promise<RuntimeConfigState> {
	const globalConfigPath = getRuntimeGlobalConfigPath();
	const projectConfigPath = getRuntimeProjectConfigPath(cwd);
	const globalConfig = await readRuntimeConfigFile<RuntimeGlobalConfigFileShape>(globalConfigPath);
	const projectConfig = await readRuntimeConfigFile<RuntimeProjectConfigFileShape>(projectConfigPath);
	return toRuntimeConfigState({
		globalConfigPath,
		projectConfigPath,
		globalConfig,
		projectConfig,
	});
}

export async function saveRuntimeConfig(
	cwd: string,
	config: {
		selectedAgentId: RuntimeAgentId;
		readyForReviewNotificationsEnabled: boolean;
		shortcuts: RuntimeProjectShortcut[];
		commitLocalPromptTemplate: string;
		commitWorktreePromptTemplate: string;
		openPrLocalPromptTemplate: string;
		openPrWorktreePromptTemplate: string;
	},
): Promise<RuntimeConfigState> {
	const globalConfigPath = getRuntimeGlobalConfigPath();
	const projectConfigPath = getRuntimeProjectConfigPath(cwd);
	await writeRuntimeGlobalConfigFile(globalConfigPath, {
		selectedAgentId: config.selectedAgentId,
		readyForReviewNotificationsEnabled: config.readyForReviewNotificationsEnabled,
		commitLocalPromptTemplate: config.commitLocalPromptTemplate,
		commitWorktreePromptTemplate: config.commitWorktreePromptTemplate,
		openPrLocalPromptTemplate: config.openPrLocalPromptTemplate,
		openPrWorktreePromptTemplate: config.openPrWorktreePromptTemplate,
	});
	await writeRuntimeProjectConfigFile(projectConfigPath, { shortcuts: config.shortcuts });
	return {
		globalConfigPath,
		projectConfigPath,
		selectedAgentId: normalizeAgentId(config.selectedAgentId),
		readyForReviewNotificationsEnabled: normalizeBoolean(
			config.readyForReviewNotificationsEnabled,
			DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED,
		),
		shortcuts: normalizeShortcuts(config.shortcuts),
		commitLocalPromptTemplate: normalizePromptTemplate(
			config.commitLocalPromptTemplate,
			DEFAULT_COMMIT_LOCAL_PROMPT_TEMPLATE,
		),
		commitWorktreePromptTemplate: normalizePromptTemplate(
			config.commitWorktreePromptTemplate,
			DEFAULT_COMMIT_WORKTREE_PROMPT_TEMPLATE,
		),
		openPrLocalPromptTemplate: normalizePromptTemplate(
			config.openPrLocalPromptTemplate,
			DEFAULT_OPEN_PR_LOCAL_PROMPT_TEMPLATE,
		),
		openPrWorktreePromptTemplate: normalizePromptTemplate(
			config.openPrWorktreePromptTemplate,
			DEFAULT_OPEN_PR_WORKTREE_PROMPT_TEMPLATE,
		),
		commitLocalPromptTemplateDefault: DEFAULT_COMMIT_LOCAL_PROMPT_TEMPLATE,
		commitWorktreePromptTemplateDefault: DEFAULT_COMMIT_WORKTREE_PROMPT_TEMPLATE,
		openPrLocalPromptTemplateDefault: DEFAULT_OPEN_PR_LOCAL_PROMPT_TEMPLATE,
		openPrWorktreePromptTemplateDefault: DEFAULT_OPEN_PR_WORKTREE_PROMPT_TEMPLATE,
	};
}
