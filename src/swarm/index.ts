/**
 * AI Agent Swarm — a system for orchestrating multi-agent discussions.
 *
 * This module enables multiple AI agents with distinct personas to engage
 * in structured, round-based discussions that explore topics from multiple
 * perspectives and arrive at reasoned conclusions.
 *
 * ## Quick Start
 *
 * ```ts
 * import { SwarmOrchestrator, getBalancedSwarmPersonas } from "./swarm";
 *
 * const personas = getBalancedSwarmPersonas();
 * const swarm = new SwarmOrchestrator(personas);
 *
 * const conclusion = await swarm.discuss(
 *   "Should remote work be mandatory for our engineering team?",
 *   "We are a 50-person startup with offices in SF and NYC.",
 * );
 *
 * console.log(conclusion.summary);
 * console.log(conclusion.consensus);
 * ```
 *
 * ## Architecture
 *
 * - **Personas** (`persona.ts`): Pre-defined agent roles with distinct
 *   perspectives (Analyst, Optimist, Skeptic, Strategist, etc.)
 * - **Agents** (`agent.ts`): Individual agents that generate responses
 *   based on their persona traits and the discussion context
 * - **Orchestrator** (`orchestrator.ts`): Manages the discussion lifecycle:
 *   opening statements → round-based discussion → convergence detection
 *   → structured conclusion
 * - **Types** (`types.ts`): Core type definitions for the entire system
 *
 * @module swarm
 */

export { SwarmAgent } from "./agent";
export { SwarmOrchestrator } from "./orchestrator";
export type { SwarmEventCallbacks } from "./orchestrator";
export {
	getBalancedSwarmPersonas,
	getCompactSwarmPersonas,
	getPersonasByIds,
	SWARM_PERSONAS,
	SWARM_PERSONA_MAP,
} from "./persona";
export {
	DEFAULT_SWARM_CONFIG,
} from "./types";
export type {
	AgentId,
	AgentPersona,
	AgentTraits,
	DiscussionStatus,
	KeyInsight,
	SwarmConclusion,
	SwarmConfig,
	SwarmDiscussion,
	SwarmMessage,
} from "./types";
