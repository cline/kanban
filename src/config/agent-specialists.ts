import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeAgentId } from "../core/api-contract";

/** A single user-defined specialist agent entry from agents.json. */
export interface AgentSpecialist {
	/** Unique name used as the agentId in team_spawn_teammate, e.g. "planner", "poet". */
	id: string;
	/** The underlying CLI agent that runs this specialist, e.g. "claude", "codex". */
	baseAgentId: RuntimeAgentId;
	/** Human-readable description of this specialist's role, injected as the rolePrompt. */
	description: string;
}

/** Schema for the agents.json file shape — an array of specialist definitions. */
type AgentSpecialistsFileShape = Array<{
	id?: unknown;
	baseAgentId?: unknown;
	description?: unknown;
}>;

/** Validates a raw parsed value is a valid AgentSpecialist. */
function isValidSpecialist(raw: {
	id?: unknown;
	baseAgentId?: unknown;
	description?: unknown;
}): raw is AgentSpecialist {
	return (
		typeof raw.id === "string" &&
		raw.id.trim().length > 0 &&
		typeof raw.baseAgentId === "string" &&
		raw.baseAgentId.trim().length > 0 &&
		typeof raw.description === "string" &&
		raw.description.trim().length > 0
	);
}

/**
 * Loads custom agent specialists from .cline/kanban/agents.json in the given
 * project root. Returns an empty array if the file does not exist or is invalid.
 * Uses synchronous I/O so it can be called inline during prompt rendering.
 */
export function loadAgentSpecialists(projectRoot: string): AgentSpecialist[] {
	const filePath = join(projectRoot, ".cline", "kanban", "agents.json");
	try {
		const raw = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw) as AgentSpecialistsFileShape;
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.filter(isValidSpecialist);
	} catch {
		// File missing or malformed — silently return empty.
		return [];
	}
}
