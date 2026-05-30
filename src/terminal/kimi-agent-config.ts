import { join } from "node:path";

import { lockedFileSystem } from "../fs/locked-file-system";

export interface EnsureKimiKanbanAgentFileInput {
	additionalSystemPrompt: string;
	agentFilePath: string;
}

export function getKimiKanbanAgentFilePath(runtimeHomePath: string): string {
	return join(runtimeHomePath, "hooks", "kimi", "agent.yaml");
}

export function buildKimiKanbanAgentFileContent(additionalSystemPrompt: string): string {
	return `${JSON.stringify(
		{
			version: 1,
			agent: {
				extend: "default",
				name: "kanban",
				system_prompt_args: {
					ROLE_ADDITIONAL: additionalSystemPrompt,
				},
			},
		},
		null,
		2,
	)}\n`;
}

export async function ensureKimiKanbanAgentFile(input: EnsureKimiKanbanAgentFileInput): Promise<string> {
	await lockedFileSystem.writeTextFileAtomic(
		input.agentFilePath,
		buildKimiKanbanAgentFileContent(input.additionalSystemPrompt),
	);
	return input.agentFilePath;
}
