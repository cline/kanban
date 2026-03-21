import type { RuntimeAgentId, RuntimeClineProviderSettings } from "@/runtime/types";
import { isClineProviderAuthenticated } from "@/runtime/native-agent";

function normalizeBooleanEnvValue(value: string | undefined): string {
	return value?.trim().toLowerCase() ?? "";
}

export function isOnboardingForceShowEnabled(value: string | undefined): boolean {
	const normalized = normalizeBooleanEnvValue(value);
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isSelectedAgentAuthenticated(
	selectedAgentId: RuntimeAgentId | null | undefined,
	clineProviderSettings: RuntimeClineProviderSettings | null | undefined,
): boolean {
	if (selectedAgentId !== "cline") {
		return true;
	}
	return isClineProviderAuthenticated(clineProviderSettings);
}

export function shouldShowStartupOnboardingDialog(input: {
	hasShownOnboardingDialog: boolean;
	isTaskAgentReady: boolean | null | undefined;
	isSelectedAgentAuthenticated: boolean;
	forceShowOnboardingDialog: boolean;
}): boolean {
	if (input.forceShowOnboardingDialog) {
		return true;
	}
	if (!input.hasShownOnboardingDialog) {
		return true;
	}
	if (input.isTaskAgentReady === null || input.isTaskAgentReady === undefined) {
		return false;
	}
	if (!input.isSelectedAgentAuthenticated) {
		return true;
	}
	return input.isTaskAgentReady === false;
}
