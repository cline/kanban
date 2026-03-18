// Centralize direct SDK runtime imports here.
// All native Cline session-host creation and persisted artifact reads should
// flow through this boundary so the rest of Kanban stays decoupled from the
// SDK package layout.
import {
	buildWorkspaceMetadata,
	createSessionHost,
	type SessionHost,
} from "../../third_party/cline-sdk/packages/core/dist/server/index.js";
import { getClineDefaultSystemPrompt } from "../../third_party/cline-sdk/packages/agents/dist/index.js";
import type { SessionRecord } from "../../third_party/cline-sdk/packages/core/dist/types/sessions.js";
import type { providers as ClineSdkProviders } from "../../third_party/cline-sdk/packages/llms/dist/index.js";

export type ClineSdkSessionHost = SessionHost;
export type ClineSdkSessionRecord = SessionRecord;
export type ClineSdkPersistedMessage = ClineSdkProviders.Message;

export async function createClineSdkSessionHost(): Promise<ClineSdkSessionHost> {
	return await createSessionHost({ backendMode: "local" });
}

export async function buildClineSdkWorkspaceMetadata(cwd: string): Promise<string> {
	return await buildWorkspaceMetadata(cwd);
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
	return getClineDefaultSystemPrompt("Terminal Shell", input.cwd, workspaceMetadata, input.rules ?? "");
}
