/**
 * Swarm orchestrator — manages the discussion lifecycle.
 *
 * Responsible for:
 * 1. Initializing the discussion with a topic and agent roster
 * 2. Managing round-based turn-taking
 * 3. Detecting convergence and consensus
 * 4. Producing the final structured conclusion
 * 5. Providing event callbacks for progress tracking
 */
import { SwarmAgent } from "./agent";
import type {
	AgentPersona,
	KeyInsight,
	SwarmConclusion,
	SwarmConfig,
	SwarmDiscussion,
	SwarmMessage,
} from "./types";

import { DEFAULT_SWARM_CONFIG } from "./types";

/** Progress callback type for observing discussion events */
export interface SwarmEventCallbacks {
	onRoundStart?: (round: number, totalRounds: number) => void;
	onAgentSpeaking?: (agentId: string, agentName: string, message: string) => void;
	onRoundComplete?: (round: number, messageCount: number) => void;
	onConvergenceDetected?: (confidence: number) => void;
	onConclusion?: (conclusion: SwarmConclusion) => void;
	onError?: (error: Error) => void;
}

/**
 * The orchestrator that drives a swarm discussion from topic to conclusion.
 *
 * Usage:
 * ```ts
 * const swarm = new SwarmOrchestrator(personas, config);
 * const conclusion = await swarm.discuss("Topic", "Context", callbacks);
 * ```
 */
export class SwarmOrchestrator {
	private readonly agents: SwarmAgent[];
	private readonly config: SwarmConfig;
	private discussion: SwarmDiscussion;

	constructor(personas: AgentPersona[], config?: Partial<SwarmConfig>) {
		if (personas.length < 2) {
			throw new Error("Swarm requires at least 2 agents for a meaningful discussion");
		}

		this.agents = personas.map((p) => new SwarmAgent(p));
		this.config = { ...DEFAULT_SWARM_CONFIG, ...config };
		this.discussion = this._createEmptyDiscussion();
	}

	/** Returns the list of participating agents */
	getParticipants(): SwarmAgent[] {
		return [...this.agents];
	}

	/** Returns the current discussion state */
	getDiscussionState(): SwarmDiscussion {
		return { ...this.discussion, messages: [...this.discussion.messages] };
	}

	/**
	 * Runs a full swarm discussion on the given topic.
	 */
	async discuss(
		topic: string,
		context: string,
		callbacks?: SwarmEventCallbacks,
	): Promise<SwarmConclusion> {
		this.discussion = this._createDiscussion(topic, context);

		try {
			if (this.config.includeOpeningStatements) {
				await this._runOpeningStatements(callbacks);
			}
			await this._runDiscussionRounds(callbacks);
			return this._finalizeConclusion(callbacks);
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			callbacks?.onError?.(err);
			throw err;
		}
	}

	// ====================================================================
	// Private helpers
	// ====================================================================

	private _createEmptyDiscussion(): SwarmDiscussion {
		return {
			topic: "",
			context: "",
			maxRounds: this.config.maxRounds,
			currentRound: 0,
			messages: [],
			status: "in-progress",
			participants: [],
		};
	}

	private _createDiscussion(topic: string, context: string): SwarmDiscussion {
		return {
			topic,
			context,
			maxRounds: this.config.maxRounds,
			currentRound: 0,
			messages: [],
			status: "in-progress",
			participants: this.agents.map((a) => a.persona.id),
		};
	}

	/**
	 * Phase 1: Each agent delivers an opening statement.
	 */
	private async _runOpeningStatements(
		callbacks?: SwarmEventCallbacks,
	): Promise<void> {
		for (const agent of this.agents) {
			const content = agent.generateOpeningStatement(
				this.discussion.topic,
				this.discussion.context,
			);
			this._addMessage(agent.persona.id, content);
			callbacks?.onAgentSpeaking?.(agent.persona.id, agent.persona.name, content);
		}
	}

	/**
	 * Phase 2: Run through discussion rounds. In each round, every agent
	 * gets a turn to respond. Between rounds, check for convergence.
	 */
	private async _runDiscussionRounds(
		callbacks?: SwarmEventCallbacks,
	): Promise<void> {
		while (this.discussion.currentRound < this.config.maxRounds) {
			const round = this.discussion.currentRound + 1;
			callbacks?.onRoundStart?.(round, this.config.maxRounds);
			let messagesThisRound = 0;

			for (const agent of this.agents) {
				const content = agent.generateResponse(
					this.discussion.topic,
					this.discussion.context,
					this.discussion,
				);
				this._addMessage(agent.persona.id, content);
				messagesThisRound++;
				callbacks?.onAgentSpeaking?.(agent.persona.id, agent.persona.name, content);
			}

			this.discussion.currentRound++;
			callbacks?.onRoundComplete?.(round, messagesThisRound);

			// Check for convergence after minimum rounds
			if (this.discussion.currentRound >= this.config.minRoundsBeforeConvergence) {
				const confidence = this._detectConvergence();
				if (confidence >= this.config.convergenceThreshold) {
					this.discussion.status = "converging";
					callbacks?.onConvergenceDetected?.(confidence);
					if (this.discussion.currentRound >= this.config.minRoundsBeforeConvergence + 1) {
						this.discussion.status = "concluded";
						return;
					}
				}
			}
		}

		if (this.discussion.status === "in-progress") {
			this.discussion.status = "max-rounds-reached";
		}
	}

	/**
	 * Phase 3: Analyze the discussion and produce the final conclusion.
	 */
	private _finalizeConclusion(callbacks?: SwarmEventCallbacks): SwarmConclusion {
		const conclusion = this._synthesizeConclusion();
		this.discussion.status = "concluded";
		callbacks?.onConclusion?.(conclusion);
		return conclusion;
	}

	private _addMessage(agentId: string, content: string): void {
		this.discussion.messages.push({
			agentId,
			content,
			round: this.discussion.currentRound,
			timestamp: Date.now(),
		});
	}

	// ====================================================================
	// Convergence detection
	// ====================================================================

	/**
	 * Detects convergence by analyzing the discussion messages.
	 *
	 * Algorithm:
	 * 1. Look at the most recent round of messages
	 * 2. Check for agreement/disagreement patterns
	 * 3. Measure how much agents build on vs. challenge each other
	 * 4. Identify whether discussion is narrowing toward shared conclusions
	 *
	 * Returns a confidence score from 0 to 1 (strong consensus).
	 */
	private _detectConvergence(): number {
		const messages = this.discussion.messages;
		if (messages.length < this.agents.length * 2) return 0;

		const latestRound = this.discussion.currentRound;
		const recentMessages = messages.filter((m) => m.round >= latestRound - 1);
		const factors: number[] = [];

		// Factor 1: Agreement ratio
		const agreementKeywords = ["agree", "support", "build on", "aligned", "shared", "consensus", "common ground"];
		const agreeCount = recentMessages.filter((m) =>
			agreementKeywords.some((kw) => m.content.toLowerCase().includes(kw)),
		).length;
		factors.push(agreeCount / Math.max(recentMessages.length, 1));

		// Factor 2: Disagreement ratio (inverted)
		const disagreementKeywords = ["disagree", "push back", "problem", "flaw", "gap", "overlook", "issue", "concern"];
		const disagreeCount = recentMessages.filter((m) =>
			disagreementKeywords.some((kw) => m.content.toLowerCase().includes(kw)),
		).length;
		factors.push(1 - disagreeCount / Math.max(recentMessages.length, 1));

		// Factor 3: Synthesis ratio
		const synthesisKeywords = ["synthesize", "bridge", "incorporate", "balance", "integrate", "holistic"];
		const synthesisCount = recentMessages.filter((m) =>
			synthesisKeywords.some((kw) => m.content.toLowerCase().includes(kw)),
		).length;
		factors.push(Math.min(synthesisCount / this.agents.length, 1));

		// Factor 4: Topic focus
		const topicTerms = this.discussion.topic.toLowerCase().split(/\s+/);
		const topicRefCount = recentMessages.filter((m) =>
			topicTerms.some((term) => term.length > 3 && m.content.toLowerCase().includes(term)),
		).length;
		factors.push(topicRefCount / Math.max(recentMessages.length, 1));

		// Weighted average
		const weights = [0.3, 0.25, 0.25, 0.2];
		const weightedScore = factors.reduce((sum, factor, i) => sum + factor * (weights[i] ?? 0.25), 0);
		return Math.min(weightedScore, 1);
	}

	// ====================================================================
	// Conclusion synthesis
	// ====================================================================

	private _synthesizeConclusion(): SwarmConclusion {
		const messages = this.discussion.messages;
		const consensus = this._extractConsensusPoints(messages);
		const dissenting = this._extractDissentingPoints(messages);
		const keyInsights = this._extractKeyInsights(messages);
		const agentContributions = this._summarizeAgentContributions(messages);
		const confidence = this._detectConvergence();

		return {
			topic: this.discussion.topic,
			consensus,
			dissenting,
			summary: this._generateSummary(messages, consensus, dissenting),
			confidence,
			keyInsights,
			agentContributions,
			roundsCompleted: this.discussion.currentRound,
		};
	}

	private _extractConsensusPoints(messages: SwarmMessage[]): string[] {
		const points: string[] = [];
		const patterns = [
			/we (all|largely|generally) agree/i,
			/there (is|seems to be) (broad|general|strong) (agreement|consensus)/i,
			/(everyone|all of us) (seems to|appears to) (agree|concur)/i,
			/common ground/i,
			/shared (understanding|view|perspective|conclusion)/i,
		];

		for (const message of messages) {
			for (const pattern of patterns) {
				if (!message.content.match(pattern)) continue;
				const sentences = message.content.split(/[.!?]+/);
				for (const sentence of sentences) {
					if (pattern.test(sentence) && sentence.trim().length > 20) {
						points.push(sentence.trim());
					}
				}
				break;
			}
		}
		return [...new Set(points)].slice(0, 5);
	}

	private _extractDissentingPoints(messages: SwarmMessage[]): string[] {
		const points: string[] = [];
		const patterns = [
			/(push back|pushback)/i,
			/I (must |have to |would )?(disagree|challenge|caution|counter)/i,
			/(however|that said|on the other hand|conversely),/i,
			/a (different|competing|alternative|contrary) (view|perspective|approach)/i,
			/concern(s)? (about|with|regarding)/i,
			/not (convinced|certain|sure) (that|about)/i,
		];

		for (const message of messages) {
			for (const pattern of patterns) {
				if (!message.content.match(pattern)) continue;
				const sentences = message.content.split(/[.!?]+/);
				for (const sentence of sentences) {
					if (pattern.test(sentence) && sentence.trim().length > 20) {
						points.push(sentence.trim());
					}
				}
				break;
			}
		}
		return [...new Set(points)].slice(0, 3);
	}

	private _extractKeyInsights(messages: SwarmMessage[]): KeyInsight[] {
		const insights: KeyInsight[] = [];
		const agentNames = new Map(this.agents.map((a) => [a.persona.id, a.persona.name]));
		const markers = [/importan(t|tly)/i, /key (point|insight|consideration|factor)/i, /critical/i, /notable/i, /significant/i, /fundamental/i];

		for (const message of messages) {
			if (!markers.some((m) => m.test(message.content))) continue;
			const sentences = message.content.split(/[.!?]+/);
			const keySentence = sentences.find((s) => markers.some((m) => m.test(s)));
			if (!keySentence || keySentence.trim().length < 30) continue;

			const supportedBy: string[] = [];
			const msgIndex = messages.indexOf(message);
			for (let i = msgIndex + 1; i < messages.length; i++) {
				const later = messages[i];
				if (later.agentId === message.agentId) continue;
				const ref = new RegExp(`(${agentNames.get(message.agentId) ?? ""}|${message.agentId})`, "i");
				if (ref.test(later.content)) supportedBy.push(later.agentId);
			}
			insights.push({ content: keySentence.trim(), sourceAgentId: message.agentId, supportedBy: [...new Set(supportedBy)] });
		}
		return insights.sort((a, b) => b.supportedBy.length - a.supportedBy.length).slice(0, 5);
	}

	private _summarizeAgentContributions(messages: SwarmMessage[]): SwarmConclusion["agentContributions"] {
		return this.agents.map((agent) => {
			const agentMsg = messages.filter((m) => m.agentId === agent.persona.id);
			const keyStmts = agentMsg
				.map((m) => {
					const ss = m.content.split(/[.!?]+/);
					return ss.find((s) => s.trim().length > 40 && !/I'd be interested/i.test(s) && !/These are my thoughts/i.test(s) && !/This is a complex topic/i.test(s));
				})
				.filter(Boolean) as string[];
			const summary = keyStmts.length > 0 ? keyStmts.slice(0, 2).join(". ").trim() : `Participated as ${agent.persona.role}.`;
			return { agentId: agent.persona.id, agentName: agent.persona.name, role: agent.persona.role, summary };
		});
	}

	private _generateSummary(messages: SwarmMessage[], consensus: string[], dissenting: string[]): string {
		let summary = `A swarm discussion was conducted with ${this.agents.length} agents over ${this.discussion.currentRound} rounds, yielding ${messages.length} total exchanges. `;
		if (consensus.length > 0) summary += `The group reached areas of consensus${consensus.length > 1 ? " on several points" : ""}. `;
		if (dissenting.length > 0) summary += `${dissenting.length} ${dissenting.length > 1 ? "points" : "point"} of constructive disagreement ${dissenting.length > 1 ? "were" : "was"} identified. `;
		return summary;
	}
}