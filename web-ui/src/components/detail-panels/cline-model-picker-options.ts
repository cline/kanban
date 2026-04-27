import type { SearchSelectOption } from "@/components/search-select-dropdown";
import type { RuntimeClineProviderModel, RuntimeClineReasoningEffort } from "@/runtime/types";

const CLINE_PROVIDER_ID = "cline";

const CLINE_MODEL_NAME_BY_ID: Record<string, string> = {
	"anthropic/claude-opus-4.6": "Claude Opus 4.6",
	"anthropic/claude-sonnet-4.6": "Claude Sonnet 4.6",
	"openai/gpt-5.3-codex": "GPT-5.3 Codex",
	"openai/gpt-5.4": "GPT-5.4",
	"google/gemini-3.1-pro-preview": "Gemini 3.1 Pro Preview",
	"google/gemini-3.1-flash-lite-preview": "Gemini 3.1 Flash Lite Preview",
	"xiaomi/mimo-v2-pro": "Mimo v2 Pro",
};

export const CLINE_REASONING_EFFORT_OPTIONS: SearchSelectOption[] = [
	{ value: "", label: "Default" },
	{ value: "low", label: "Low" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
	{ value: "xhigh", label: "Extra high" },
];

export interface BuildClineAgentModelPickerOptionsResult {
	options: SearchSelectOption[];
	recommendedModelIds: string[];
	freeModelIds: string[];
	shouldPinSelectedModelToTop: boolean;
}

export function buildClineAgentModelPickerOptions(
	providerId: string,
	providerModels: readonly RuntimeClineProviderModel[],
): BuildClineAgentModelPickerOptionsResult {
	const defaultOptions = providerModels.map((model) => ({
		value: model.id,
		label: model.name,
	}));
	if (providerId.trim().toLowerCase() !== CLINE_PROVIDER_ID) {
		return {
			options: defaultOptions,
			recommendedModelIds: [],
			freeModelIds: [],
			shouldPinSelectedModelToTop: true,
		};
	}

	const optionsById = new Map(defaultOptions.map((option) => [option.value, option] as const));
	const recommendedOptions = providerModels
		.filter((model) => typeof model.recommendedRank === "number")
		.sort((left, right) => {
			const leftRank = left.recommendedRank ?? Number.MAX_SAFE_INTEGER;
			const rightRank = right.recommendedRank ?? Number.MAX_SAFE_INTEGER;
			if (leftRank !== rightRank) {
				return leftRank - rightRank;
			}
			return left.name.localeCompare(right.name);
		})
		.map((model) => optionsById.get(model.id))
		.filter((option): option is SearchSelectOption => option !== undefined);
	const recommendedModelIds = recommendedOptions.map((option) => option.value);
	const recommendedModelIdSet = new Set(recommendedModelIds);
	const freeOptions = providerModels
		.filter((model) => typeof model.freeRank === "number" && !recommendedModelIdSet.has(model.id))
		.sort((left, right) => {
			const leftRank = left.freeRank ?? Number.MAX_SAFE_INTEGER;
			const rightRank = right.freeRank ?? Number.MAX_SAFE_INTEGER;
			if (leftRank !== rightRank) {
				return leftRank - rightRank;
			}
			return left.name.localeCompare(right.name);
		})
		.map((model) => optionsById.get(model.id))
		.filter((option): option is SearchSelectOption => option !== undefined);
	const freeModelIds = freeOptions.map((option) => option.value);
	const freeModelIdSet = new Set(freeModelIds);
	const nonFeaturedOptions = defaultOptions.filter(
		(option) => !recommendedModelIdSet.has(option.value) && !freeModelIdSet.has(option.value),
	);

	return {
		options: [...recommendedOptions, ...freeOptions, ...nonFeaturedOptions],
		recommendedModelIds,
		freeModelIds,
		shouldPinSelectedModelToTop: false,
	};
}

export function formatClineReasoningEffortLabel(value: RuntimeClineReasoningEffort | "" | null | undefined): string {
	return CLINE_REASONING_EFFORT_OPTIONS.find((option) => option.value === (value ?? ""))?.label ?? "Default";
}

export function formatClineSelectedModelButtonText({
	modelName,
	reasoningEffort,
	showReasoningEffort = false,
}: {
	modelName: string;
	reasoningEffort?: RuntimeClineReasoningEffort | "" | null;
	showReasoningEffort?: boolean;
}): string {
	if (!showReasoningEffort || !reasoningEffort) {
		return modelName;
	}
	return `${modelName} (${formatClineReasoningEffortLabel(reasoningEffort)})`;
}

export function getClineReasoningEnabledModelIds(providerModels: readonly RuntimeClineProviderModel[]): string[] {
	return providerModels.filter((model) => model.supportsReasoningEffort).map((model) => model.id);
}

export function resolveClineModelDisplayName(modelId: string): string {
	const trimmedModelId = modelId.trim();
	if (!trimmedModelId) {
		return modelId;
	}
	return CLINE_MODEL_NAME_BY_ID[trimmedModelId] ?? trimmedModelId;
}

export function buildClineSelectedModelButtonText({
	modelOptions,
	selectedModelId,
	reasoningEffort,
	showReasoningEffort,
	isModelLoading = false,
	isModelSaving = false,
	loadingLabel = "Loading models...",
	savingLabel = "Saving model...",
	emptyLabel = "Select model",
}: {
	modelOptions: readonly SearchSelectOption[];
	selectedModelId: string;
	reasoningEffort?: RuntimeClineReasoningEffort | "" | null;
	showReasoningEffort: boolean;
	isModelLoading?: boolean;
	isModelSaving?: boolean;
	loadingLabel?: string;
	savingLabel?: string;
	emptyLabel?: string;
}): string {
	if (isModelSaving) {
		return savingLabel;
	}
	if (isModelLoading) {
		return loadingLabel;
	}
	const selectedOption = modelOptions.find((option) => option.value === selectedModelId);
	const trimmedModelId = selectedModelId.trim();
	const selectedModelName = selectedOption?.label ?? (trimmedModelId.length > 0 ? trimmedModelId : emptyLabel);
	return formatClineSelectedModelButtonText({
		modelName: selectedModelName,
		reasoningEffort,
		showReasoningEffort,
	});
}
