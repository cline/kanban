import { useCallback, useEffect, useState } from "react";
import { isSelectedAgentAuthenticated, shouldShowStartupOnboardingDialog } from "@/runtime/onboarding";
import { saveRuntimeConfig as saveRuntimeConfigQuery } from "@/runtime/runtime-config-query";
import type { RuntimeAgentId, RuntimeConfigResponse } from "@/runtime/types";
import { LocalStorageKey } from "@/storage/local-storage-store";
import { useBooleanLocalStorageValue } from "@/utils/react-use";

interface UseStartupOnboardingOptions {
	currentProjectId: string | null;
	runtimeProjectConfig: RuntimeConfigResponse | null;
	isRuntimeProjectConfigLoading: boolean;
	isTaskAgentReady: boolean | null;
	refreshRuntimeProjectConfig: () => void;
	refreshSettingsRuntimeProjectConfig: () => void;
}

interface AgentSelectionResult {
	ok: boolean;
	message?: string;
}

export interface UseStartupOnboardingResult {
	isStartupOnboardingDialogOpen: boolean;
	handleOpenStartupOnboardingDialog: () => void;
	handleCloseStartupOnboardingDialog: () => void;
	handleSelectOnboardingAgent: (agentId: RuntimeAgentId) => Promise<AgentSelectionResult>;
	handleOnboardingClineSetupSaved: () => void;
}

export function useStartupOnboarding(options: UseStartupOnboardingOptions): UseStartupOnboardingResult {
	const {
		currentProjectId,
		runtimeProjectConfig,
		isRuntimeProjectConfigLoading,
		isTaskAgentReady,
		refreshRuntimeProjectConfig,
		refreshSettingsRuntimeProjectConfig,
	} = options;
	const [isStartupOnboardingDialogOpen, setIsStartupOnboardingDialogOpen] = useState(false);
	const [isStartupOnboardingDialogForcedOpen, setIsStartupOnboardingDialogForcedOpen] = useState(false);
	const [didDismissStartupOnboardingForSession, setDidDismissStartupOnboardingForSession] = useState(false);
	const [hasShownOnboardingDialog, setHasShownOnboardingDialog] = useBooleanLocalStorageValue(
		LocalStorageKey.OnboardingDialogShown,
		false,
	);
	const selectedAgentAuthenticated = isSelectedAgentAuthenticated(
		runtimeProjectConfig?.selectedAgentId,
		runtimeProjectConfig?.clineProviderSettings,
	);

	useEffect(() => {
		setDidDismissStartupOnboardingForSession(false);
		setIsStartupOnboardingDialogForcedOpen(false);
	}, [currentProjectId]);

	useEffect(() => {
		if (isRuntimeProjectConfigLoading && runtimeProjectConfig === null) {
			setIsStartupOnboardingDialogOpen(false);
			return;
		}
		if (isStartupOnboardingDialogForcedOpen) {
			setIsStartupOnboardingDialogOpen(true);
			return;
		}
		if (didDismissStartupOnboardingForSession) {
			setIsStartupOnboardingDialogOpen(false);
			return;
		}
		setIsStartupOnboardingDialogOpen(
			shouldShowStartupOnboardingDialog({
				hasShownOnboardingDialog,
				isTaskAgentReady,
				isSelectedAgentAuthenticated: selectedAgentAuthenticated,
			}),
		);
	}, [
		didDismissStartupOnboardingForSession,
		hasShownOnboardingDialog,
		isStartupOnboardingDialogForcedOpen,
		isRuntimeProjectConfigLoading,
		isTaskAgentReady,
		runtimeProjectConfig,
		selectedAgentAuthenticated,
	]);

	const handleOpenStartupOnboardingDialog = useCallback(() => {
		setDidDismissStartupOnboardingForSession(false);
		setIsStartupOnboardingDialogForcedOpen(true);
		setIsStartupOnboardingDialogOpen(true);
	}, []);

	const handleCloseStartupOnboardingDialog = useCallback(() => {
		setIsStartupOnboardingDialogForcedOpen(false);
		setHasShownOnboardingDialog(true);
		setDidDismissStartupOnboardingForSession(true);
		setIsStartupOnboardingDialogOpen(false);
	}, [setHasShownOnboardingDialog]);

	const handleSelectOnboardingAgent = useCallback(
		async (agentId: RuntimeAgentId): Promise<AgentSelectionResult> => {
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
		isStartupOnboardingDialogOpen,
		handleOpenStartupOnboardingDialog,
		handleCloseStartupOnboardingDialog,
		handleSelectOnboardingAgent,
		handleOnboardingClineSetupSaved,
	};
}
