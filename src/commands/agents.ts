import type { Command } from "commander";

import { loadGlobalRuntimeConfig, loadRuntimeConfig } from "../config/runtime-config";
import { resolveProjectInputPath } from "../projects/project-path";
import { buildAgentCapabilityReport } from "../terminal/agent-registry";

function printJson(payload: unknown): void {
	process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}
	return String(error);
}

export function registerAgentsCommand(program: Command): void {
	program
		.command("agents")
		.description("List known coding agents, their launch support, and per-task override mechanisms.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { projectPath?: string }) => {
			try {
				const normalizedProjectPath = (options.projectPath ?? "").trim();
				const runtimeConfig = normalizedProjectPath
					? await loadRuntimeConfig(resolveProjectInputPath(normalizedProjectPath, process.cwd()))
					: await loadGlobalRuntimeConfig();
				printJson({
					ok: true,
					agents: buildAgentCapabilityReport(runtimeConfig),
				});
			} catch (error) {
				printJson({
					ok: false,
					error: `Agents command failed: ${toErrorMessage(error)}`,
				});
				process.exitCode = 1;
			}
		});
}
