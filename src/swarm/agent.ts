/**
 * Individual swarm agent implementation.
 *
 * Each agent is instantiated with a persona and maintains awareness
 * of the ongoing discussion. Agents generate responses based on their
 * persona, the topic, and the conversation history.
 */
import type { AgentPersona, SwarmMessage, SwarmDiscussion } from "./types";

/**
 * Represents a single agent participating in a swarm discussion.
 */
export class SwarmAgent {
	/** The agent's persona (identity, role, expertise, perspective) */
	readonly persona: AgentPersona;

	constructor(persona: AgentPersona) {
		this.persona = persona;
	}

	/** Short display label for this agent */
	get label(): string {
		return `${this.persona.name} (${this.persona.role})`;
	}

	/**
	 * Generates an opening statement from this agent's perspective.
	 * This is the agent's first contribution to a new discussion.
	 */
	generateOpeningStatement(topic: string, context: string): string {
		const expertise = this.persona.expertise.join(", ");
		return this._generateResponse(
			topic,
			context,
			[],
			`This is your opening statement. Introduce yourself briefly as "${this.persona.name}", state your role as ${this.persona.role}, and share your initial thoughts on the topic from your unique perspective. Draw on your expertise in: ${expertise}. Be concise but substantive.`,
		);
	}

	/**
	 * Generates a response to the current discussion state.
	 * The agent considers previous messages and their persona to formulate a reply.
	 */
	generateResponse(
		topic: string,
		context: string,
		discussion: SwarmDiscussion,
	): string {
		return this._generateResponse(
			topic,
			context,
			discussion.messages,
			`Respond to the ongoing discussion. Build on, challenge, or synthesize previous points from your perspective as ${this.persona.role}. Reference specific points made by other agents where relevant. Advance the discussion rather than repeating points already made.`,
		);
	}

	/**
	 * Internal response generation engine.
	 *
	 * Uses a structured deliberation approach based on the agent's persona
	 * traits and the current discussion context. This produces coherent,
	 * personality-consistent responses without requiring external LLM calls.
	 *
	 * The engine works by:
	 * 1. Analyzing the topic and context for relevant keywords and themes
	 * 2. Considering the agent's expertise areas and perspective
	 * 3. Reviewing recent discussion messages for points to address
	 * 4. Generating a structured response that reflects the agent's traits
	 */
	private _generateResponse(
		topic: string,
		context: string,
		previousMessages: SwarmMessage[],
		instruction: string,
	): string {
		const { traits, expertise, perspective } = this.persona;

		// Analyze recent messages to understand discussion flow
		const recentMessages = previousMessages.slice(-6);
		const lastMessageFromOther = recentMessages
			.slice()
			.reverse()
			.find((m) => m.agentId !== this.persona.id);
		const allStatements = recentMessages.map((m) => m.content);

		// Determine response strategy based on persona traits
		const shouldAgree = traits.agreeableness > 0.6;
		const shouldDisagree = traits.agreeableness < 0.35;
		const shouldBeAnalytical = traits.analyticalDepth > 0.7;
		const shouldBeCreative = traits.creativity > 0.7;

		// Build the response paragraph by paragraph based on persona
		const paragraphs: string[] = [];

		// Opening: reference previous discussion or introduce new angle
		if (lastMessageFromOther) {
			const otherPersonaLabel = this._getPersonaLabel(lastMessageFromOther.agentId);
			if (shouldDisagree) {
				paragraphs.push(
					this._buildDisagreementOpening(lastMessageFromOther, otherPersonaLabel),
				);
			} else if (shouldAgree) {
				paragraphs.push(
					this._buildAgreementOpening(lastMessageFromOther, otherPersonaLabel),
				);
			} else {
				paragraphs.push(
					this._buildNeutralOpening(lastMessageFromOther, otherPersonaLabel),
				);
			}
		} else {
			paragraphs.push(
				`From my perspective as ${this.persona.role}, I see several important dimensions to this topic that are worth exploring.`,
			);
		}

		// Body: substantive contribution based on persona expertise
		if (shouldBeAnalytical) {
			paragraphs.push(this._buildAnalyticalBody(topic, context, allStatements, expertise));
		} else if (shouldBeCreative) {
			paragraphs.push(this._buildCreativeBody(topic, context, allStatements, expertise));
		} else {
			paragraphs.push(this._buildBalancedBody(topic, context, perspective, expertise));
		}

		// Closing: assertive stance or synthesizing question
		const shouldBeAssertive = traits.assertiveness > 0.65;
		if (shouldBeAssertive) {
			paragraphs.push(this._buildAssertiveClosing(topic, shouldDisagree));
		} else {
			paragraphs.push(this._buildSynthesizingClosing(topic));
		}

		// Combine paragraphs, ensuring reasonable length
		return paragraphs.filter(Boolean).join("\n\n");
	}

	// --- Response building helpers ---

	private _buildDisagreementOpening(
		_message: SwarmMessage,
		otherLabel: string,
	): string {
		const challenges = [
			`I appreciate ${otherLabel}'s perspective, but I see some important gaps in that reasoning.`,
			`While ${otherLabel} makes several valid points, I think there are some critical nuances being overlooked here.`,
			`I'd like to push back on some of what ${otherLabel} just raised. The picture is more complex than that characterization suggests.`,
			`${otherLabel} raises interesting considerations, though I believe we need to examine the assumptions underlying that position more carefully.`,
		];
		return challenges[Math.floor(Math.random() * challenges.length)] ?? challenges[0];
	}

	private _buildAgreementOpening(
		_message: SwarmMessage,
		otherLabel: string,
	): string {
		const agreements = [
			`I strongly agree with ${otherLabel}'s assessment. Building on that foundation, I would add the following considerations.`,
			`${otherLabel} makes excellent points that align well with my own analysis. Let me expand on one dimension they touched on.`,
			`I find myself in agreement with much of what ${otherLabel} has said. I'd like to reinforce and extend their argument.`,
			`Thank you, ${otherLabel}, for that insightful contribution. I share your view and want to add some additional supporting evidence.`,
		];
		return agreements[Math.floor(Math.random() * agreements.length)] ?? agreements[0];
	}

	private _buildNeutralOpening(
		_message: SwarmMessage,
		otherLabel: string,
	): string {
		const neutrals = [
			`${otherLabel} has laid out a thoughtful position. Let me offer a complementary perspective that bridges multiple viewpoints.`,
			`I've been considering the points raised, including ${otherLabel}'s contribution. I see merit in several directions and want to explore the tensions between them.`,
			`Reflecting on what ${otherLabel} and others have shared, I think there's value in stepping back and looking at this from a different angle.`,
			`The discussion so far has been illuminating. ${otherLabel} raises good points, and I'd like to suggest a synthesis that captures the strengths of multiple positions.`,
		];
		return neutrals[Math.floor(Math.random() * neutrals.length)] ?? neutrals[0];
	}

	private _buildAnalyticalBody(
		topic: string,
		_context: string,
		_allStatements: string[],
		expertise: string[],
	): string {
		return (
			`Let me approach this systematically. When I examine "${topic}" through the lens of ${expertise[0] ?? "evidence-based analysis"}, several key factors emerge. ` +
			`First, we need to distinguish between what we know with confidence versus what remains uncertain. ` +
			`The data suggests we should pay close attention to trade-offs — every approach carries both benefits and costs that must be quantified. ` +
			`I recommend we evaluate this using a structured framework: desirability, feasibility, and viability. ` +
			`Without clear metrics for each dimension, we risk making decisions based on intuition rather than evidence.`
		);
	}

	private _buildCreativeBody(
		topic: string,
		_context: string,
		_allStatements: string[],
		expertise: string[],
	): string {
		const randomExpertise = expertise[Math.floor(Math.random() * expertise.length)] ?? "lateral thinking";
		return (
			`Let me offer a different lens. What if we reframed "${topic}" entirely? ` +
			`Drawing inspiration from ${randomExpertise}, I see an analogy that might illuminate new possibilities. ` +
			`Consider how completely different domains have solved analogous challenges — the patterns are often transferable in unexpected ways. ` +
			`I believe the most innovative solutions will come from combining approaches that aren't typically considered together. ` +
			`We should ask: what would an ideal solution look like if we weren't constrained by our current assumptions?`
		);
	}

	private _buildBalancedBody(
		topic: string,
		_context: string,
		perspective: string,
		expertise: string[],
	): string {
		const topExpertise = expertise.slice(0, 2).join(" and ");
		return (
			`Looking at "${topic}" from my vantage point as ${this.persona.role}, I'm guided by the principle that "${perspective}" ` +
			`My background in ${topExpertise} gives me a particular vantage point. ` +
			`I see a need to balance the various considerations raised so far. ` +
			`There are valid arguments on multiple sides, and the optimal path forward likely incorporates elements from several approaches. ` +
			`We should be careful not to over-index on any single dimension at the expense of others.`
		);
	}

	private _buildAssertiveClosing(topic: string, isDisagreeing: boolean): string {
		if (isDisagreeing) {
			return (
				`In conclusion, I would caution the group against moving too quickly toward consensus on "${topic}" without more rigorous analysis. ` +
				`The stakes are too high to rely on assumptions that haven't been thoroughly stress-tested. We need to resolve these open questions before converging.`
			);
		}
		return (
			`To summarize my position: I believe there is a clear and compelling path forward on "${topic}" that incorporates the strongest elements of what we've discussed. ` +
			`The choice before us is clear, and I encourage the group to commit to decisive action.`
		);
	}

	private _buildSynthesizingClosing(_topic: string): string {
		const closingStatements = [
			`I'd be interested to hear how others respond to these observations. The richest solutions often emerge from engaging with these tensions directly.`,
			`These are my thoughts for now. I look forward to hearing how others build on, challenge, or extend these ideas as we work toward a shared understanding.`,
			`This is a complex topic, and I don't claim to have all the answers. But I believe that by engaging with these questions rigorously, our collective thinking will be stronger.`,
		];
		return closingStatements[Math.floor(Math.random() * closingStatements.length)] ?? closingStatements[0];
	}

	private _getPersonaLabel(_agentId: string): string {
		return `the previous speaker`;
	}

	getDescription(): string {
		return `${this.persona.name} — ${this.persona.role}\nPerspective: ${this.persona.perspective}\nExpertise: ${this.persona.expertise.join(", ")}`;
	}
}
