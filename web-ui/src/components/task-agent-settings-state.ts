import { cloneRuntimeTaskAgentSettings } from "@runtime-task-agent-settings";
import { useEffect } from "react";

import type { RuntimeTaskAgentSettings } from "@/runtime/types";

export function shouldPreserveEmptyOverride(currentSettings: RuntimeTaskAgentSettings | undefined): boolean {
	return currentSettings !== undefined && Object.keys(currentSettings).length === 0;
}

// After mutating a settings clone, decide whether to keep it or clear the
// override entirely: a marker object ({}) survives only when an empty
// override was already in place (Cline treats object presence as the marker).
export function resolveAgentSettingsOrClear(
	nextSettings: RuntimeTaskAgentSettings,
	preserveEmptyOverride: boolean,
): RuntimeTaskAgentSettings | undefined {
	const hasValues = Boolean(nextSettings.providerId || nextSettings.modelId || nextSettings.reasoningEffort);
	return hasValues || preserveEmptyOverride ? nextSettings : undefined;
}

export function patchAgentSettings(
	current: RuntimeTaskAgentSettings | undefined,
	patch: (next: RuntimeTaskAgentSettings) => void,
	preserveEmptyOverride = shouldPreserveEmptyOverride(current),
): RuntimeTaskAgentSettings | undefined {
	const nextSettings = cloneRuntimeTaskAgentSettings(current) ?? {};
	patch(nextSettings);
	return resolveAgentSettingsOrClear(nextSettings, preserveEmptyOverride);
}

export function useResetInvalidSelectedModel({
	enabled,
	modelId,
	modelOptions,
	isLoadingModels,
	agentSettings,
	onAgentSettingsChange,
}: {
	enabled: boolean;
	modelId: string | undefined;
	modelOptions: Array<{ value: string; label: string }>;
	isLoadingModels: boolean;
	agentSettings: RuntimeTaskAgentSettings | undefined;
	onAgentSettingsChange?: (value: RuntimeTaskAgentSettings | undefined) => void;
}): void {
	useEffect(() => {
		if (!enabled || isLoadingModels || !modelId || modelOptions.length <= 1) {
			return;
		}
		const modelExists = modelOptions.some((opt) => opt.value === modelId);
		if (modelExists) {
			return;
		}
		const firstRealModel = modelOptions.find((opt) => opt.value !== "");
		onAgentSettingsChange?.(
			patchAgentSettings(agentSettings, (nextSettings) => {
				if (firstRealModel?.value) {
					nextSettings.modelId = firstRealModel.value;
				} else {
					delete nextSettings.modelId;
				}
			}),
		);
	}, [agentSettings, enabled, isLoadingModels, modelId, modelOptions, onAgentSettingsChange]);
}
