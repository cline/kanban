import {
	type ClineSdkToolApprovalRequest,
	type ClineSdkToolApprovalResult,
	type ClineSdkUserInstructionService,
	createClineSdkUserInstructionService,
	loadClineSdkRulesForSystemPrompt,
	resolveClineSdkWorkflowSlashCommand,
} from "./sdk-runtime-boundary";

export interface ClineRuntimeSetup {
	userInstructionService: ClineSdkUserInstructionService;
	resolvePrompt: (prompt: string) => string;
	loadRules: () => string;
	requestToolApproval: (request: ClineSdkToolApprovalRequest) => Promise<ClineSdkToolApprovalResult>;
	dispose: () => Promise<void>;
}

export async function createClineRuntimeSetup(workspacePath: string): Promise<ClineRuntimeSetup> {
	const userInstructionService = createClineSdkUserInstructionService(workspacePath);
	try {
		await userInstructionService.start();
	} catch {}

	return {
		userInstructionService,
		resolvePrompt: (prompt: string) => resolveClineSdkWorkflowSlashCommand(prompt, userInstructionService),
		loadRules: () => loadClineSdkRulesForSystemPrompt(userInstructionService),
		requestToolApproval: async (request: ClineSdkToolApprovalRequest) => ({
			approved: true,
			reason: `Approved by Kanban runtime for ${request.toolName}.`,
		}),
		dispose: async () => {
			try {
				userInstructionService.stop();
			} catch {}
		},
	};
}
