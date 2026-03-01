import type { RuntimeTaskWorkspaceInfoResponse } from "@/kanban/runtime/types";

export type TaskGitAction = "commit" | "pr";

export const TASK_GIT_PROMPT_VARIABLES = [
	{
		token: "{{base_ref}}",
		descriptions: {
			local: "The branch this local workspace is on.",
			worktree: "The branch this worktree was created from.",
		},
	},
] as const;

export interface TaskGitPromptTemplates {
	commitLocalPromptTemplate?: string | null;
	commitWorktreePromptTemplate?: string | null;
	openPrLocalPromptTemplate?: string | null;
	openPrWorktreePromptTemplate?: string | null;
	commitLocalPromptTemplateDefault?: string | null;
	commitWorktreePromptTemplateDefault?: string | null;
	openPrLocalPromptTemplateDefault?: string | null;
	openPrWorktreePromptTemplateDefault?: string | null;
}

interface BuildTaskGitActionPromptInput {
	action: TaskGitAction;
	workspaceInfo: RuntimeTaskWorkspaceInfoResponse;
	templates?: TaskGitPromptTemplates | null;
}

function resolveTemplate(
	action: TaskGitAction,
	mode: RuntimeTaskWorkspaceInfoResponse["mode"],
	templates?: TaskGitPromptTemplates | null,
): string {
	if (action === "commit") {
		const template = (
			mode === "worktree"
				? templates?.commitWorktreePromptTemplate
				: templates?.commitLocalPromptTemplate
		)?.trim();
		if (template) {
			return template;
		}
		const defaultTemplate = (
			mode === "worktree"
				? templates?.commitWorktreePromptTemplateDefault
				: templates?.commitLocalPromptTemplateDefault
		)?.trim();
		if (defaultTemplate) {
			return defaultTemplate;
		}
		return "Handle this commit action using the provided git context.";
	}
	const template = (
		mode === "worktree"
			? templates?.openPrWorktreePromptTemplate
			: templates?.openPrLocalPromptTemplate
	)?.trim();
	if (template) {
		return template;
	}
	const defaultTemplate = (
		mode === "worktree"
			? templates?.openPrWorktreePromptTemplateDefault
			: templates?.openPrLocalPromptTemplateDefault
	)?.trim();
	if (defaultTemplate) {
		return defaultTemplate;
	}
	return "Handle this pull request action using the provided git context.";
}

function interpolateTemplate(template: string, variables: Record<string, string>): string {
	let result = template;
	for (const [key, value] of Object.entries(variables)) {
		result = result.replaceAll(`{{${key}}}`, value);
	}
	return result;
}

export function buildTaskGitActionPrompt(input: BuildTaskGitActionPromptInput): string {
	const variables: Record<string, string> = {
		base_ref:
			input.workspaceInfo.baseRef ??
			"unknown (determine the correct base branch before proceeding)",
	};
	const template = resolveTemplate(input.action, input.workspaceInfo.mode, input.templates);
	return interpolateTemplate(template, variables);
}
