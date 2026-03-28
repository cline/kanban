import { describe, expect, it } from "vitest";

import {
	buildClineAgentModelPickerOptions,
	CLINE_RECOMMENDED_MODEL_IDS,
	formatClineReasoningEffortLabel,
	formatClineSelectedModelButtonText,
} from "@/components/detail-panels/cline-model-picker-options";
import type { RuntimeClineProviderModel } from "@/runtime/types";

function createModel(id: string, name: string): RuntimeClineProviderModel {
	return { id, name };
}

describe("buildClineAgentModelPickerOptions", () => {
	it("returns recommended models first for the cline provider", () => {
		const models: RuntimeClineProviderModel[] = [
			createModel("openai/gpt-5.4", "GPT-5.4"),
			createModel("openai/gpt-5.2", "GPT-5.2"),
			createModel("anthropic/claude-opus-4.6", "Claude Opus 4.6"),
			createModel("anthropic/claude-sonnet-4.6", "Claude Sonnet 4.6"),
			createModel("openai/gpt-5.3-codex", "GPT-5.3 Codex"),
			createModel("google/gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview"),
			createModel("google/gemini-3.1-flash-lite-preview", "Gemini 3.1 Flash Lite Preview"),
			createModel("xiaomi/mimo-v2-pro", "Mimo v2 Pro"),
		];

		const result = buildClineAgentModelPickerOptions("cline", models);

		expect(result.options.map((option) => option.value)).toEqual([...CLINE_RECOMMENDED_MODEL_IDS, "openai/gpt-5.2"]);
		expect(result.recommendedModelIds).toEqual([...CLINE_RECOMMENDED_MODEL_IDS]);
		expect(result.shouldPinSelectedModelToTop).toBe(false);
	});

	it("keeps original ordering for non-cline providers", () => {
		const models: RuntimeClineProviderModel[] = [
			createModel("model-a", "Model A"),
			createModel("model-b", "Model B"),
		];

		const result = buildClineAgentModelPickerOptions("openrouter", models);

		expect(result.options.map((option) => option.value)).toEqual(["model-a", "model-b"]);
		expect(result.recommendedModelIds).toEqual([]);
		expect(result.shouldPinSelectedModelToTop).toBe(true);
	});
});

describe("cline model labels", () => {
	it("formats reasoning effort labels for display", () => {
		expect(formatClineReasoningEffortLabel("")).toBe("Default");
		expect(formatClineReasoningEffortLabel("xhigh")).toBe("Extra high");
	});

	it("appends non-default reasoning effort to the selected model label", () => {
		expect(
			formatClineSelectedModelButtonText({
				modelName: "GPT-5.4",
				reasoningEffort: "high",
				showReasoningEffort: true,
			}),
		).toBe("GPT-5.4 (High)");
	});

	it("omits reasoning effort when it is not shown", () => {
		expect(
			formatClineSelectedModelButtonText({
				modelName: "GPT-5.4",
				reasoningEffort: "high",
				showReasoningEffort: false,
			}),
		).toBe("GPT-5.4");
	});
});
