import {
	type ClineSdkToolApprovalRequest,
	type ClineSdkToolApprovalResult,
	type ClineSdkUserInstructionWatcher,
	createClineSdkUserInstructionWatcher,
	loadClineSdkRulesForSystemPrompt,
	resolveClineSdkWorkflowSlashCommand,
} from "./sdk-runtime-boundary.js";

export interface ClineRuntimeSetup {
	watcher: ClineSdkUserInstructionWatcher;
	resolvePrompt: (prompt: string) => string;
	loadRules: () => string;
	requestToolApproval: (request: ClineSdkToolApprovalRequest) => Promise<ClineSdkToolApprovalResult>;
	dispose: () => Promise<void>;
}

export async function createClineRuntimeSetup(workspacePath: string): Promise<ClineRuntimeSetup> {
	const watcher = createClineSdkUserInstructionWatcher(workspacePath);
	await watcher.start().catch(() => {});

	return {
		watcher,
		resolvePrompt: (prompt: string) => resolveClineSdkWorkflowSlashCommand(prompt, watcher),
		loadRules: () => loadClineSdkRulesForSystemPrompt(watcher),
		requestToolApproval: async (request: ClineSdkToolApprovalRequest) => ({
			approved: true,
			reason: `Approved by Kanban runtime for ${request.toolName}.`,
		}),
		dispose: async () => {
			await watcher.stop().catch(() => {});
		},
	};
}
