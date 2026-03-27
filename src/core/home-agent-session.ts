import type { RuntimeAgentId } from "./api-contract.js";

// The home sidebar agent panel is not backed by a real task card.
// We mint a synthetic home agent session id so the existing task-scoped
// runtime APIs can manage its chat and terminal lifecycle without creating
// a worktree-backed task. Home sidebar sessions should use a stable synthetic
// task id so refreshes and session reloads can reconnect to the same chat.
const HOME_AGENT_SESSION_NAMESPACE = "__home_agent__";

export const HOME_AGENT_SESSION_PREFIX = `${HOME_AGENT_SESSION_NAMESPACE}:`;

export function createHomeAgentSessionId(workspaceId: string, agentId: RuntimeAgentId): string {
	return `${HOME_AGENT_SESSION_PREFIX}${workspaceId}:${agentId}`;
}

export function isHomeAgentSessionId(sessionId: string): boolean {
	return sessionId.startsWith(HOME_AGENT_SESSION_PREFIX);
}

export function isHomeAgentSessionIdForWorkspace(sessionId: string, workspaceId: string): boolean {
	return sessionId.startsWith(`${HOME_AGENT_SESSION_PREFIX}${workspaceId}:`);
}
