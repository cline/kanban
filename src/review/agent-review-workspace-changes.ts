import type { RuntimeWorkspaceChangesResponse } from "../core/api-contract.js";
import { getWorkspaceChanges, getWorkspaceChangesFromRef } from "../workspace/get-workspace-changes.js";
import { resolveAgentReviewGitRange } from "./agent-review-runner.js";

export async function getAgentReviewWorkspaceChanges(input: {
	workspacePath: string;
	baseRef: string;
}): Promise<RuntimeWorkspaceChangesResponse | null> {
	const gitRange = await resolveAgentReviewGitRange(input.workspacePath, input.baseRef).catch(() => null);
	if (gitRange?.baseSha) {
		const changesFromBase = await getWorkspaceChangesFromRef({
			cwd: input.workspacePath,
			fromRef: gitRange.baseSha,
		}).catch(() => null);
		if (changesFromBase) {
			return changesFromBase;
		}
	}

	return await getWorkspaceChanges(input.workspacePath).catch(() => null);
}

export function hasAgentReviewableChanges(
	changes: RuntimeWorkspaceChangesResponse | null | undefined,
): boolean {
	return (changes?.files.length ?? 0) > 0;
}
