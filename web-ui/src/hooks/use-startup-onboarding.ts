import { useCallback, useEffect, useRef, useState } from "react";
import { shouldShowStartupOnboardingDialog } from "@/runtime/onboarding";
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

/**
 * Access the Electron desktop persistent settings API (if available).
 * Returns null when running in a browser (non-desktop).
 */
function getDesktopApi(): {
	getDesktopSetting: (key: string) => Promise<string | null>;
	setDesktopSetting: (key: string, value: string) => void;
} | null {
	const w = window as unknown as Record<string, unknown>;
	if (typeof w.desktop === "object" && w.desktop !== null) {
		const d = w.desktop as Record<string, unknown>;
		if (typeof d.getDesktopSetting === "function" && typeof d.setDesktopSetting === "function") {
			return d as {
				getDesktopSetting: (key: string) => Promise<string | null>;
				setDesktopSetting: (key: string, value: string) => void;
			};
		}
	}
	return null;
}

export function useStartupOnboarding(options: UseStartupOnboardingOptions): UseStartupOnboardingResult {
	const {
		currentProjectId,
		runtimeProjectConfig,
		isRuntimeProjectConfigLoading,
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

	// On mount, hydrate from desktop persistent settings (survives port changes).
	const didHydrateRef = useRef(false);
	useEffect(() => {
		if (didHydrateRef.current) return;
		didHydrateRef.current = true;
		const desktopApi = getDesktopApi();
		if (!desktopApi) return;
		desktopApi
			.getDesktopSetting(LocalStorageKey.OnboardingDialogShown)
			.then((value) => {
				if (value === "true") {
					setHasShownOnboardingDialog(true);
				}
			})
			.catch(() => {
				/* best effort */
			});
	}, [setHasShownOnboardingDialog]);

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
			}),
		);
	}, [
		didDismissStartupOnboardingForSession,
		hasShownOnboardingDialog,
		isStartupOnboardingDialogForcedOpen,
		isRuntimeProjectConfigLoading,
		runtimeProjectConfig,
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
		// Also persist to desktop file-backed store (survives port/origin changes).
		getDesktopApi()?.setDesktopSetting(LocalStorageKey.OnboardingDialogShown, "true");
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
