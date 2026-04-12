import {
	anthropicModels,
	bedrockModels,
	clineDevstralModelInfo,
	deepseekModels,
	doubaoModels,
	fireworksModels,
	geminiModels,
	groqModels,
	lmStudioModels,
	mistralModels,
	ollamaModels,
	openAIModels,
	openRouterDefaultModelInfo,
	openRouterModels,
	qwenModels,
	vertexModels,
	xaiModels,
} from "@shared/api";

/**
 * Gets the actual context window size from official model definitions
 * This is the single source of truth - no guesswork by string matching
 */
export function getModelContextWindow(modelId: string): number {
	if (!modelId) {
		return openRouterDefaultModelInfo.contextWindow;
	}

	const normalizedId = modelId.toLowerCase().trim();

	// Check all official model registries
	const modelRegistries = [
		anthropicModels,
		openRouterModels,
		bedrockModels,
		vertexModels,
		geminiModels,
		openAIModels,
		ollamaModels,
		lmStudioModels,
		deepseekModels,
		qwenModels,
		doubaoModels,
		mistralModels,
		fireworksModels,
		xaiModels,
		groqModels,
	];

	for (const registry of modelRegistries) {
		// Exact match first
		if (normalizedId in registry) {
			const model = registry[normalizedId as keyof typeof registry];
			if (model.contextWindow && model.contextWindow > 0) {
				return model.contextWindow;
			}
		}

		// Partial match for prefixed/suffixed variants
		for (const [key, model] of Object.entries(registry)) {
			if (normalizedId.includes(key.toLowerCase()) || key.toLowerCase().includes(normalizedId)) {
				if (model.contextWindow && model.contextWindow > 0) {
					return model.contextWindow;
				}
			}
		}
	}

	// Check special models
	if (normalizedId.includes("devstral")) {
		return clineDevstralModelInfo.contextWindow;
	}

	// Safe default for unknown models
	return openRouterDefaultModelInfo.contextWindow;
}
