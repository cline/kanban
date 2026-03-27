// Implements workspace-scoped prompts library operations: fetch catalog,
// apply/remove prompts to the workspace, and list applied prompts.

import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
	RuntimeAppliedPromptsResponse,
	RuntimeApplyPromptRequest,
	RuntimeApplyPromptResponse,
	RuntimePromptType,
	RuntimePromptsCatalog,
	RuntimeRemovePromptRequest,
	RuntimeRemovePromptResponse,
} from "../core/api-contract.js";
import { fetchPromptsCatalog } from "../services/prompts-service.js";
import type { RuntimeTrpcContext, RuntimeTrpcWorkspaceScope } from "./app-router.js";

function toKebabCase(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

function resolvePromptDirectory(workspacePath: string, type: RuntimePromptType): string {
	if (type === "workflow") {
		return join(workspacePath, "workflows");
	}
	// Default: rules go in .clinerules/
	return join(workspacePath, ".clinerules");
}

function resolvePromptFilename(name: string): string {
	const kebab = toKebabCase(name);
	return kebab ? `${kebab}.md` : "prompt.md";
}

export function createPromptsApi(): RuntimeTrpcContext["promptsApi"] {
	return {
		fetchCatalog: async (): Promise<RuntimePromptsCatalog> => {
			return await fetchPromptsCatalog();
		},

		applyPrompt: async (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeApplyPromptRequest,
		): Promise<RuntimeApplyPromptResponse> => {
			try {
				let content = input.content;

				// If content is empty, fetch from GitHub raw CDN
				if (!content.trim()) {
					const repoDir = input.type === "workflow" ? "workflows" : ".clinerules";
					const fileName = `${input.promptId}.md`;
					const rawUrl = `https://raw.githubusercontent.com/cline/prompts/main/${repoDir}/${fileName}`;
					const response = await fetch(rawUrl, { signal: AbortSignal.timeout(10_000) });
					if (!response.ok) {
						return { ok: false, error: `Failed to fetch prompt content from GitHub: ${response.status}` };
					}
					content = await response.text();
				}

				const dir = resolvePromptDirectory(scope.workspacePath, input.type);
				await mkdir(dir, { recursive: true });

				const filename = resolvePromptFilename(input.name);
				const filePath = join(dir, filename);
				await writeFile(filePath, content, "utf-8");

				return { ok: true };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, error: message };
			}
		},

		removePrompt: async (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeRemovePromptRequest,
		): Promise<RuntimeRemovePromptResponse> => {
			try {
				const dir = resolvePromptDirectory(scope.workspacePath, input.type);
				const filename = resolvePromptFilename(input.name);
				const filePath = join(dir, filename);
				await unlink(filePath);
				return { ok: true };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				// If file doesn't exist, treat as success
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					return { ok: true };
				}
				return { ok: false, error: message };
			}
		},

		getAppliedPrompts: async (
			scope: RuntimeTrpcWorkspaceScope,
		): Promise<RuntimeAppliedPromptsResponse> => {
			const appliedPromptIds: string[] = [];

			const scanDirectory = async (dir: string, type: RuntimePromptType): Promise<void> => {
				try {
					const entries = await readdir(dir);
					for (const entry of entries) {
						if (entry.toLowerCase().endsWith(".md")) {
							const promptId = entry.replace(/\.md$/, "");
							appliedPromptIds.push(`${type}:${promptId}`);
						}
					}
				} catch (error) {
					// Directory might not exist — that's fine
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
						throw error;
					}
				}
			};

			await Promise.all([
				scanDirectory(join(scope.workspacePath, ".clinerules"), "rule"),
				scanDirectory(join(scope.workspacePath, "workflows"), "workflow"),
			]);

			return { appliedPromptIds };
		},
	};
}
