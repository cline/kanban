import type { SdkReasoningEffort } from "../cline-sdk/sdk-provider-boundary";
import {
	type RuntimeClineReasoningEffort,
	type RuntimeTaskAgentSettings,
	runtimeClineReasoningEffortSchema,
} from "./api-contract";

type AssertAssignable<T extends U, U> = T;
export type RuntimeClineEffortMatchesSdk = AssertAssignable<RuntimeClineReasoningEffort, SdkReasoningEffort>;

// Normalized copy of a task's agent settings: trims provider/model IDs, drops
// empty fields, and never retains a caller-owned object reference.
export function cloneRuntimeTaskAgentSettings(
	settings?: RuntimeTaskAgentSettings | null,
): RuntimeTaskAgentSettings | undefined {
	if (settings === undefined || settings === null) {
		return undefined;
	}
	const providerId = settings.providerId?.trim();
	const modelId = settings.modelId?.trim();
	return {
		...(providerId ? { providerId } : {}),
		...(modelId ? { modelId } : {}),
		...(settings.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}),
	};
}

// Cards store opaque effort strings, but the Cline SDK only accepts its own
// vocabulary. Map a card value to the narrow Cline effort type; anything
// outside the vocabulary resolves to null.
export function parseRuntimeClineReasoningEffort(value: string | null | undefined): RuntimeClineReasoningEffort | null {
	const parsed = runtimeClineReasoningEffortSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
