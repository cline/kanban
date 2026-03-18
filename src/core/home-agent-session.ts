import type { RuntimeAgentId } from "./api-contract.js";

// The home sidebar agent panel is not backed by a real task card.
// We mint a synthetic home agent session id so the existing task-scoped
// runtime APIs can manage its chat and terminal lifecycle without creating
// a worktree-backed task. Home sidebar sessions are intentionally ephemeral,
// so callers should create a fresh id per in-memory sidebar session instead of
// deriving one that survives a browser refresh.
const HOME_AGENT_SESSION_NAMESPACE = "__home_agent__";

export const HOME_AGENT_SESSION_PREFIX = `${HOME_AGENT_SESSION_NAMESPACE}:`;

function createHomeAgentSessionNonce(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID().replaceAll("-", "");
	}
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function createHomeAgentSessionId(workspaceId: string, agentId: RuntimeAgentId): string {
	return `${HOME_AGENT_SESSION_PREFIX}${workspaceId}:${agentId}:${createHomeAgentSessionNonce()}`;
}

export function isHomeAgentSessionId(sessionId: string): boolean {
	return sessionId.startsWith(HOME_AGENT_SESSION_PREFIX);
}

export function isHomeAgentSessionIdForWorkspace(sessionId: string, workspaceId: string): boolean {
	return sessionId.startsWith(`${HOME_AGENT_SESSION_PREFIX}${workspaceId}:`);
}
