/**
 * Core type definitions for the AI Agent Swarm system.
 *
 * A swarm is a collection of AI agents with distinct personas that engage
 * in a structured, round-based discussion to explore a topic and arrive
 * at a reasoned conclusion.
 */

/** Unique identifier for each agent in the swarm */
export type AgentId = string;

/**
 * The role/persona of an agent. Each agent has a distinct perspective
 * that shapes how they analyze topics and respond to others.
 */
export interface AgentPersona {
	/** Unique identifier */
	id: AgentId;
	/** Display name (e.g., "Dr. Ada Lovelace") */
	name: string;
	/** Short role title (e.g., "The Analyst", "The Skeptic") */
	role: string;
	/** Areas of expertise */
	expertise: string[];
	/** One-line description of their perspective */
	perspective: string;
	/** System prompt that defines their behavior and viewpoint */
	systemPrompt: string;
	/** Personality traits that influence response style */
	traits: AgentTraits;
}

/** Personality traits that modulate how an agent communicates */
export interface AgentTraits {
	/** 0-1 scale: tendency to agree with others (0 = always skeptical, 1 = always agreeable) */
	agreeableness: number;
	/** 0-1 scale: depth of analysis (0 = surface-level, 1 = deeply analytical) */
	analyticalDepth: number;
	/** 0-1 scale: creativity of thinking (0 = strictly logical, 1 = highly creative) */
	creativity: number;
	/** 0-1 scale: assertiveness in expressing opinions (0 = timid, 1 = forceful) */
	assertiveness: number;
}

/** A single message in the discussion */
export interface SwarmMessage {
	/** Which agent sent this */
	agentId: AgentId;
	/** The content of their statement */
	content: string;
	/** Which round this was posted in (0-based) */
	round: number;
	/** Unix timestamp when the message was generated */
	timestamp: number;
}

/** Current status of a discussion */
export type DiscussionStatus = "in-progress" | "converging" | "concluded" | "max-rounds-reached";

/** Full state of an ongoing discussion */
export interface SwarmDiscussion {
	/** The topic or question under discussion */
	topic: string;
	/** Additional context provided to the swarm */
	context: string;
	/** Maximum number of rounds before forced conclusion */
	maxRounds: number;
	/** Current round number (0-based) */
	currentRound: number;
	/** All messages exchanged so far */
	messages: SwarmMessage[];
	/** Current status */
	status: DiscussionStatus;
	/** Agents participating */
	participants: AgentId[];
}

/** Configuration for the swarm discussion */
export interface SwarmConfig {
	/** Maximum number of discussion rounds */
	maxRounds: number;
	/** Minimum rounds before convergence can be detected */
	minRoundsBeforeConvergence: number;
	/** Confidence threshold (0-1) to consider the discussion concluded */
	convergenceThreshold: number;
	/** Whether to include opening statements from all agents first */
	includeOpeningStatements: boolean;
}

/** Default swarm configuration */
export const DEFAULT_SWARM_CONFIG: SwarmConfig = {
	maxRounds: 5,
	minRoundsBeforeConvergence: 2,
	convergenceThreshold: 0.75,
	includeOpeningStatements: true,
};

/** A key insight extracted from the discussion */
export interface KeyInsight {
	content: string;
	sourceAgentId: AgentId;
	supportedBy: AgentId[];
}

/** The final output of a swarm discussion */
export interface SwarmConclusion {
	/** The original topic */
	topic: string;
	/** Points of consensus reached */
	consensus: string[];
	/** Points where agents disagreed */
	dissenting: string[];
	/** Executive summary of the discussion */
	summary: string;
	/** Overall confidence level (0-1) */
	confidence: number;
	/** Key insights with attribution */
	keyInsights: KeyInsight[];
	/** Per-agent contribution summary */
	agentContributions: Array<{
		agentId: AgentId;
		agentName: string;
		role: string;
		summary: string;
	}>;
	/** Number of rounds completed */
	roundsCompleted: number;
}
