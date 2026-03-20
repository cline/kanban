import { useCallback, useEffect, useMemo, useState } from "react";

import { buildTaskStartServicePromptContent, type TaskStartServicePromptContent } from "@/hooks/use-task-start-service-prompts";
import {
	isOnboardingForceShowEnabled,
	isSelectedAgentAuthenticated,
	shouldShowStartupOnboardingDialog,
} from "@/runtime/onboarding";
import { saveRuntimeConfig as saveRuntimeConfigQuery } from "@/runtime/runtime-config-query";
import type { RuntimeAgentId, RuntimeConfigResponse } from "@/runtime/types";
import { LocalStorageKey } from "@/storage/local-storage-store";
import { useBooleanLocalStorageValue } from "@/utils/react-use";

interface UseStartupOnboardingOptions {
	currentProjectId: string | null;
	hasNoProjects: boolean;
	runtimeProjectConfig: RuntimeConfigResponse | null;
	isTaskAgentReady: boolean | null;
	refreshRuntimeProjectConfig: () => void;
	refreshSettingsRuntimeProjectConfig: () => void;
}

interface AgentSelectionResult {
	ok: boolean;
	message?: string;
}

interface UseStartupOnboardingResult {
	startupOnboardingPrompt: TaskStartServicePromptContent;
	isStartupOnboardingDialogOpen: boolean;
	handleCloseStartupOnboardingDialog: () => void;
	handleSelectOnboardingAgent: (agentId: RuntimeAgentId) => Promise<AgentSelectionResult>;
	handleOnboardingClineSetupSaved: () => void;
}

export function useStartupOnboarding(options: UseStartupOnboardingOptions): UseStartupOnboardingResult {
	const {
		currentProjectId,
		hasNoProjects,
		runtimeProjectConfig,
		isTaskAgentReady,
		refreshRuntimeProjectConfig,
		refreshSettingsRuntimeProjectConfig,
	} = options;
	const [isStartupOnboardingDialogOpen, setIsStartupOnboardingDialogOpen] = useState(false);
	const [didDismissStartupOnboardingForSession, setDidDismissStartupOnboardingForSession] = useState(false);
	const [hasShownOnboardingDialog, setHasShownOnboardingDialog] = useBooleanLocalStorageValue(
		LocalStorageKey.OnboardingDialogShown,
		false,
	);
	const forceShowOnboardingDialog = isOnboardingForceShowEnabled(import.meta.env.VITE_FORCE_SHOW_ONBOARDING_DIALOG);
	const startupOnboardingPrompt = useMemo(
		() => buildTaskStartServicePromptContent("agent_cli"),
		[],
	);
	const selectedAgentAuthenticated = isSelectedAgentAuthenticated(
		runtimeProjectConfig?.selectedAgentId,
		runtimeProjectConfig?.clineProviderSettings,
	);

	useEffect(() => {
		setDidDismissStartupOnboardingForSession(false);
	}, [currentProjectId]);

	useEffect(() => {
		if (!currentProjectId || hasNoProjects || didDismissStartupOnboardingForSession) {
			setIsStartupOnboardingDialogOpen(false);
			return;
		}
		setIsStartupOnboardingDialogOpen(
			shouldShowStartupOnboardingDialog({
				hasShownOnboardingDialog,
				isTaskAgentReady,
				isSelectedAgentAuthenticated: selectedAgentAuthenticated,
				forceShowOnboardingDialog,
			}),
		);
	}, [
		currentProjectId,
		didDismissStartupOnboardingForSession,
		forceShowOnboardingDialog,
		hasNoProjects,
		hasShownOnboardingDialog,
		isTaskAgentReady,
		selectedAgentAuthenticated,
	]);

	const handleCloseStartupOnboardingDialog = useCallback(() => {
		setHasShownOnboardingDialog(true);
		setDidDismissStartupOnboardingForSession(true);
		setIsStartupOnboardingDialogOpen(false);
	}, [setHasShownOnboardingDialog]);

	const handleSelectOnboardingAgent = useCallback(
		async (agentId: RuntimeAgentId): Promise<AgentSelectionResult> => {
			if (!currentProjectId) {
				return {
					ok: false,
					message: "Select a project before choosing an agent.",
				};
			}
			try {
				await saveRuntimeConfigQuery(currentProjectId, { selectedAgentId: agentId });
				refreshRuntimeProjectConfig();
				refreshSettingsRuntimeProjectConfig();
				return { ok: true };
			} catch (error) {
				return {
					ok: false,
					message: error instanceof Error ? error.message : String(error),
				};
			}
		},
		[currentProjectId, refreshRuntimeProjectConfig, refreshSettingsRuntimeProjectConfig],
	);

	const handleOnboardingClineSetupSaved = useCallback(() => {
		refreshRuntimeProjectConfig();
		refreshSettingsRuntimeProjectConfig();
	}, [refreshRuntimeProjectConfig, refreshSettingsRuntimeProjectConfig]);

	return {
		startupOnboardingPrompt,
		isStartupOnboardingDialogOpen,
		handleCloseStartupOnboardingDialog,
		handleSelectOnboardingAgent,
		handleOnboardingClineSetupSaved,
	};
}
