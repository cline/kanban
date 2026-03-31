import { addSdkCustomProvider, type SdkCustomProviderCapability } from "./sdk-provider-boundary";

const ALIBABA_PROVIDER = {
	providerId: "alibaba",
	name: "Alibaba Coding Plan",
	baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1",
	models: [
		"glm-5",
		"glm-4.7",
		"qwen3.5-plus",
		"qwen3-max-2026-01-23",
		"qwen3-coder-next",
		"qwen3-coder-plus",
		"kimi-k2.5",
		"MiniMax-M2.5",
	],
	defaultModelId: "glm-5",
	capabilities: ["streaming", "tools", "reasoning", "prompt-cache"] as SdkCustomProviderCapability[],
};

/**
 * Register built-in custom providers at startup.
 * This makes providers like Alibaba Coding Plan available in the dropdown
 * without requiring manual configuration via the Add Provider dialog.
 */
export async function registerBuiltinCustomProviders(): Promise<void> {
	await addSdkCustomProvider(ALIBABA_PROVIDER);
}
