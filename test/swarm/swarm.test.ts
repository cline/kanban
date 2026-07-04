/**
 * Tests for the AI Agent Swarm system.
 *
 * Validates the core behaviors:
 * - Agent persona definitions
 * - Opening statement generation
 * - Round-based discussion
 * - Convergence detection
 * - Conclusion synthesis
 */
import { describe, it, expect } from "vitest";
import { SwarmOrchestrator } from "../../src/swarm/orchestrator";
import { SwarmAgent } from "../../src/swarm/agent";
import {
	getBalancedSwarmPersonas,
	getCompactSwarmPersonas,
	getPersonasByIds,
	SWARM_PERSONAS,
} from "../../src/swarm/persona";
import { DEFAULT_SWARM_CONFIG } from "../../src/swarm/types";
import type { AgentPersona, SwarmConclusion } from "../../src/swarm/types";

describe("swarm / personas", () => {
	it("should have 8 predefined personas", () => {
		expect(SWARM_PERSONAS).toHaveLength(8);
	});

	it("each persona should have all required fields", () => {
		for (const persona of SWARM_PERSONAS) {
			expect(persona.id).toBeTruthy();
			expect(persona.name).toBeTruthy();
			expect(persona.role).toBeTruthy();
			expect(persona.expertise.length).toBeGreaterThan(0);
			expect(persona.perspective).toBeTruthy();
			expect(persona.systemPrompt).toBeTruthy();
			expect(persona.traits.agreeableness).toBeGreaterThanOrEqual(0);
			expect(persona.traits.agreeableness).toBeLessThanOrEqual(1);
			expect(persona.traits.analyticalDepth).toBeGreaterThanOrEqual(0);
			expect(persona.traits.analyticalDepth).toBeLessThanOrEqual(1);
			expect(persona.traits.creativity).toBeGreaterThanOrEqual(0);
			expect(persona.traits.creativity).toBeLessThanOrEqual(1);
			expect(persona.traits.assertiveness).toBeGreaterThanOrEqual(0);
			expect(persona.traits.assertiveness).toBeLessThanOrEqual(1);
		}
	});

	it("getBalancedSwarmPersonas returns all 8 personas", () => {
		const personas = getBalancedSwarmPersonas();
		expect(personas).toHaveLength(8);
	});

	it("getCompactSwarmPersonas returns 4 personas", () => {
		const personas = getCompactSwarmPersonas();
		expect(personas).toHaveLength(4);
	});

	it("getPersonasByIds throws for unknown IDs", () => {
		expect(() => getPersonasByIds(["nonexistent"])).toThrow("Unknown persona");
	});

	it("getPersonasByIds returns correct subset", () => {
		const personas = getPersonasByIds(["analyst", "skeptic"]);
		expect(personas).toHaveLength(2);
		expect(personas[0]?.id).toBe("analyst");
		expect(personas[1]?.id).toBe("skeptic");
	});
});

describe("swarm / SwarmAgent", () => {
	const testPersona: AgentPersona = {
		id: "test-agent",
		name: "Test Agent",
		role: "The Tester",
		expertise: ["testing", "verification"],
		perspective: "Everything should be tested thoroughly.",
		systemPrompt: "You are a test agent.",
		traits: {
			agreeableness: 0.5,
			analyticalDepth: 0.7,
			creativity: 0.3,
			assertiveness: 0.6,
		},
	};

	it("should create an agent with the given persona", () => {
		const agent = new SwarmAgent(testPersona);
		expect(agent.persona.id).toBe("test-agent");
		expect(agent.label).toContain("Test Agent");
		expect(agent.label).toContain("The Tester");
	});

	it("should generate an opening statement", () => {
		const agent = new SwarmAgent(testPersona);
		const statement = agent.generateOpeningStatement("Test topic", "Test context");
		expect(statement).toBeTruthy();
		expect(statement.length).toBeGreaterThan(50);
	});

	it("should generate a response to a discussion", () => {
		const agent = new SwarmAgent(testPersona);
		const discussion = {
			topic: "Test topic",
			context: "Test context",
			maxRounds: 3,
			currentRound: 1,
			messages: [
				{
					agentId: "other-agent",
					content: "I think we should consider this carefully.",
					round: 1,
					timestamp: Date.now(),
				},
			],
			status: "in-progress" as const,
			participants: ["test-agent", "other-agent"],
		};
		const response = agent.generateResponse("Test topic", "Test context", discussion);
		expect(response).toBeTruthy();
		expect(response.length).toBeGreaterThan(50);
	});

	it("should provide a description", () => {
		const agent = new SwarmAgent(testPersona);
		const description = agent.getDescription();
		expect(description).toContain("Test Agent");
		expect(description).toContain("The Tester");
		expect(description).toContain("testing");
	});
});

describe("swarm / SwarmOrchestrator", () => {
	it("should throw with fewer than 2 agents", () => {
		expect(() => {
			new SwarmOrchestrator([SWARM_PERSONAS[0]]);
		}).toThrow("at least 2 agents");
	});

	it("should accept 2+ agents and default config", () => {
		const swarm = new SwarmOrchestrator(getCompactSwarmPersonas());
		expect(swarm.getParticipants()).toHaveLength(4);
	});

	it("should run a full discussion and produce a conclusion", async () => {
		const swarm = new SwarmOrchestrator(getCompactSwarmPersonas(), {
			maxRounds: 3,
			minRoundsBeforeConvergence: 1,
			convergenceThreshold: 0.99, // High threshold to ensure all rounds run
		});

		const conclusion = await swarm.discuss(
			"Should we adopt a 4-day work week?",
			"We are a 50-person startup considering this policy change.",
		);

		expect(conclusion).toBeDefined();
		expect(conclusion.topic).toBe("Should we adopt a 4-day work week?");
		expect(conclusion.summary).toBeTruthy();
		expect(conclusion.consensus).toBeDefined();
		expect(conclusion.dissenting).toBeDefined();
		expect(conclusion.keyInsights).toBeDefined();
		expect(conclusion.roundsCompleted).toBeGreaterThan(0);
		expect(conclusion.agentContributions).toHaveLength(4);
	});

	it("should trigger event callbacks during discussion", async () => {
		const swarm = new SwarmOrchestrator(getCompactSwarmPersonas(), {
			maxRounds: 2,
			minRoundsBeforeConvergence: 1,
			convergenceThreshold: 0.99,
		});

		const events: string[] = [];

		const conclusion = await swarm.discuss(
			"Should we use TypeScript or Rust for our new backend?",
			"We build high-performance APIs.",
			{
				onRoundStart: (round) => events.push(`round-start:${round}`),
				onAgentSpeaking: (id, _name) => events.push(`agent:${id}`),
				onRoundComplete: (round) => events.push(`round-end:${round}`),
				onConclusion: (c: SwarmConclusion) => events.push(`conclusion:${c.confidence}`),
			},
		);

		expect(events.length).toBeGreaterThan(0);
		expect(events.some((e) => e.startsWith("round-start"))).toBe(true);
		expect(events.some((e) => e.startsWith("agent:"))).toBe(true);
		expect(events.some((e) => e.startsWith("round-end"))).toBe(true);
		expect(events.some((e) => e.startsWith("conclusion:"))).toBe(true);
		expect(conclusion).toBeDefined();
	});

	it("should detect convergence with low threshold stopping early", async () => {
		const swarm = new SwarmOrchestrator(getCompactSwarmPersonas(), {
			maxRounds: 5,
			minRoundsBeforeConvergence: 2,
			convergenceThreshold: 0.2, // Very low — should converge quickly
		});

		const conclusion = await swarm.discuss(
			"Is AI alignment research adequately funded?",
			"Consider both public and private funding sources.",
		);

		expect(conclusion.roundsCompleted).toBeLessThanOrEqual(3);
	});
});

describe("swarm / defaults", () => {
	it("DEFAULT_SWARM_CONFIG should have sensible values", () => {
		expect(DEFAULT_SWARM_CONFIG.maxRounds).toBe(5);
		expect(DEFAULT_SWARM_CONFIG.minRoundsBeforeConvergence).toBe(2);
		expect(DEFAULT_SWARM_CONFIG.convergenceThreshold).toBe(0.75);
		expect(DEFAULT_SWARM_CONFIG.includeOpeningStatements).toBe(true);
	});
});
