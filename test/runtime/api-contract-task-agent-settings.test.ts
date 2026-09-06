import { describe, expect, it } from "vitest";

import { runtimeBoardCardSchema } from "../../src/core/api-contract";

function parseCard(overrides: Record<string, unknown>) {
	return runtimeBoardCardSchema.parse({
		id: "task-1",
		prompt: "do the work",
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	});
}

describe("runtimeBoardCardSchema agentSettings normalization", () => {
	it("parses legacy clineSettings into agentSettings", () => {
		const card = parseCard({
			clineSettings: { modelId: "legacy-model" },
		});
		expect(card.agentSettings).toEqual({ modelId: "legacy-model" });
		expect(card).not.toHaveProperty("clineSettings");
	});

	it("parses flat legacy cline* fields into agentSettings", () => {
		const card = parseCard({
			clineProviderId: "anthropic",
			clineModelId: "flat-model",
			clineReasoningEffort: "high",
		});
		expect(card.agentSettings).toEqual({
			providerId: "anthropic",
			modelId: "flat-model",
			reasoningEffort: "high",
		});
		expect(card).not.toHaveProperty("clineProviderId");
		expect(card).not.toHaveProperty("clineModelId");
		expect(card).not.toHaveProperty("clineReasoningEffort");
	});

	it("lets agentSettings win when both nested objects are present", () => {
		const card = parseCard({
			agentSettings: { modelId: "new-model" },
			clineSettings: { modelId: "old-model", providerId: "anthropic" },
		});
		expect(card.agentSettings).toEqual({ modelId: "new-model" });
		expect(card).not.toHaveProperty("clineSettings");
	});

	it("stores an arbitrary effort string verbatim", () => {
		const card = parseCard({
			agentSettings: { reasoningEffort: "ultracode" },
		});
		expect(card.agentSettings).toEqual({ reasoningEffort: "ultracode" });
	});
});
