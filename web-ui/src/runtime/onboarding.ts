import { isClineProviderAuthenticated } from "@/runtime/native-agent";
import type { RuntimeAgentId, RuntimeClineProviderSettings } from "@/runtime/types";

export function isSelectedAgentAuthenticated(
	selectedAgentId: RuntimeAgentId | null | undefined,
	clineProviderSettings: RuntimeClineProviderSettings | null | undefined,
): boolean {
	if (selectedAgentId !== "cline") {
		return true;
	}
	return isClineProviderAuthenticated(clineProviderSettings);
}

export function shouldShowStartupOnboardingDialog(input: { hasShownOnboardingDialog: boolean }): boolean {
	if (!input.hasShownOnboardingDialog) {
		return true;
	}
	return false;
}
