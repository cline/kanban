// Centralize direct SDK runtime imports here.
// All native Cline session-host creation and persisted artifact reads should
// flow through this boundary so the rest of Kanban stays decoupled from the
// SDK package layout.

import {
	type AgentEvent,
	type BasicLogger,
	ClineCore,
	type ClineCoreStartInput,
	type CoreSessionEvent,
	createUserInstructionConfigService,
	buildWorkspaceMetadata as fetchSdkWorkspaceMetadata,
	formatRulesForSystemPrompt,
	getClineDefaultSystemPrompt,
	isRuleEnabled,
	type MessageWithMetadata,
	type RuleConfig,
	resolveClineDataDir,
	type SessionHistoryRecord,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	type UserInstructionConfigService,
} from "@clinebot/core";
import { CLINE_BUILTIN_SLASH_COMMANDS } from "./cline-slash-commands";
import { getCliTelemetryService } from "./cline-telemetry-service";

export { TelemetryLoggerSink, TelemetryService } from "@clinebot/core";

export type ClineSdkSessionHost = ClineCore;
export type ClineSdkBasicLogger = BasicLogger;
export type ClineSdkAgentEvent = AgentEvent;

export type ClineSdkSessionEvent = CoreSessionEvent;

export type ClineSdkStartSessionInput = ClineCoreStartInput;
export type ClineSdkSessionRecord = SessionHistoryRecord;
export type ClineSdkPersistedMessage = MessageWithMetadata;
export type ClineSdkUserInstructionService = UserInstructionConfigService;
export interface ClineSdkSlashCommand {
	name: string;
	instructions: string;
	description?: string;
}
export type ClineSdkToolApprovalRequest = ToolApprovalRequest;
export type ClineSdkToolApprovalResult = ToolApprovalResult;

export async function createClineSdkSessionHost(): Promise<ClineSdkSessionHost> {
	return await ClineCore.create({
		backendMode: "auto",
		telemetry: getCliTelemetryService(),
	});
}

export function resolveClineSdkDataDir(): string {
	return resolveClineDataDir();
}
export async function buildClineSdkWorkspaceMetadata(cwd: string): Promise<string> {
	return await buildWorkspaceMetadata(cwd);
}

export function createClineSdkUserInstructionService(workspacePath: string): ClineSdkUserInstructionService {
	return createUserInstructionConfigService({
		skills: { workspacePath },
		rules: { workspacePath },
		workflows: { workspacePath },
	});
}

export function listClineSdkWorkflowSlashCommands(service?: ClineSdkUserInstructionService): ClineSdkSlashCommand[] {
	const builtIns: ClineSdkSlashCommand[] = CLINE_BUILTIN_SLASH_COMMANDS.map((command) => ({
		name: command.name,
		instructions: "",
		description: command.description,
	}));
	if (!service) {
		return builtIns;
	}
	const byName = new Map<string, ClineSdkSlashCommand>();
	for (const command of builtIns) {
		byName.set(command.name, command);
	}
	for (const command of service.listRuntimeCommands()) {
		if (byName.has(command.name)) {
			continue;
		}
		byName.set(command.name, {
			name: command.name,
			instructions: command.instructions,
			description: command.kind === "workflow" ? "Workflow command" : "Skill command",
		});
	}
	return [...byName.values()];
}

export function resolveClineSdkWorkflowSlashCommand(prompt: string, service: ClineSdkUserInstructionService): string {
	return service.resolveRuntimeSlashCommand(prompt);
}

export function loadClineSdkRulesForSystemPrompt(service: ClineSdkUserInstructionService): string {
	const rules = service
		.listRecords<RuleConfig>("rule")
		.map((record) => record.item)
		.filter(isRuleEnabled)
		.sort((left, right) => left.name.localeCompare(right.name));
	return formatRulesForSystemPrompt(rules);
}

// Cache of workspace metadata results keyed by cwd with a 30-second TTL.
// The SDK's buildWorkspaceMetadata spawns several git subprocesses
// (checkIsRepo, getRemotes, revparse HEAD, branch) on every call; the cache
// avoids repeating them for every session start within the same workspace.
// The SDK import is aliased to fetchSdkWorkspaceMetadata and shadowed by the
// cached wrapper below so existing call sites stay unchanged.
const WORKSPACE_METADATA_CACHE_TTL_MS = 30_000;
const workspaceMetadataCache = new Map<string, { value: string; expiresAt: number }>();

/** Clear the cached workspace metadata (e.g., after a git branch switch). */
export function clearWorkspaceMetadataCache(): void {
	workspaceMetadataCache.clear();
}

async function buildWorkspaceMetadata(cwd: string): Promise<string> {
	const now = Date.now();
	const cached = workspaceMetadataCache.get(cwd);
	if (cached && cached.expiresAt > now) {
		return cached.value;
	}
	const value = await fetchSdkWorkspaceMetadata(cwd);
	workspaceMetadataCache.set(cwd, { value, expiresAt: now + WORKSPACE_METADATA_CACHE_TTL_MS });
	return value;
}

export async function resolveClineSdkSystemPrompt(input: {
	cwd: string;
	providerId: string;
	rules?: string;
}): Promise<string> {
	// The Cline SDK can run against non-Cline providers too, but only the
	// "cline" provider expects the extra workspace metadata block that powers
	// its repo-aware behavior in the same way the official CLI does.
	const shouldAppendWorkspaceMetadata = input.providerId === "cline";
	const workspaceMetadata = shouldAppendWorkspaceMetadata ? await buildWorkspaceMetadata(input.cwd) : "";
	return getClineDefaultSystemPrompt({
		ide: "Kanban",
		rootPath: input.cwd,
		providerId: input.providerId,
		metadata: workspaceMetadata,
		rules: input.rules ?? "",
	});
}
