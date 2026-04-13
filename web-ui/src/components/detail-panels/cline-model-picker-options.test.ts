import { describe, expect, it } from "vitest";

import {
	buildClineAgentModelPickerOptions,
	buildClineSelectedModelButtonText,
	CLINE_RECOMMENDED_MODEL_IDS,
	formatClineReasoningEffortLabel,
	formatClineSelectedModelButtonText,
	getClineReasoningEnabledModelIds,
	resolveClineModelDisplayName,
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

	it("returns model IDs that support reasoning effort", () => {
		const models: RuntimeClineProviderModel[] = [
			{ id: "model-a", name: "Model A", supportsReasoningEffort: true },
			{ id: "model-b", name: "Model B", supportsReasoningEffort: false },
			{ id: "model-c", name: "Model C", supportsReasoningEffort: true },
		];

		expect(getClineReasoningEnabledModelIds(models)).toEqual(["model-a", "model-c"]);
	});

	it("builds selected model button text with loading and reasoning metadata", () => {
		expect(
			buildClineSelectedModelButtonText({
				modelOptions: [
					{ value: "openai/gpt-5.4", label: "GPT-5.4" },
					{ value: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" },
				],
				selectedModelId: "openai/gpt-5.4",
				reasoningEffort: "high",
				showReasoningEffort: true,
			}),
		).toBe("GPT-5.4 (High)");

		expect(
			buildClineSelectedModelButtonText({
				modelOptions: [],
				selectedModelId: "",
				showReasoningEffort: false,
				isModelLoading: true,
			}),
		).toBe("Loading models...");
	});

	it("resolves known model IDs to display names", () => {
		expect(resolveClineModelDisplayName("openai/gpt-5.4")).toBe("GPT-5.4");
		expect(resolveClineModelDisplayName("openai/unknown-model")).toBe("openai/unknown-model");
	});
});
