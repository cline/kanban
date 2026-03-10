import { useCallback, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { saveRuntimeConfig } from "@/runtime/runtime-config-query";
import type { SendTerminalInputOptions } from "@/terminal/terminal-input";

interface RuntimeShortcut {
	label: string;
	command: string;
}

interface UseShortcutActionsInput {
	currentProjectId: string | null;
	selectedShortcutLabel: string | null | undefined;
	shortcuts: RuntimeShortcut[];
	refreshRuntimeProjectConfig: () => void;
	prepareTerminalForShortcut: (input: {
		prepareWaitForTerminalConnectionReady: (taskId: string) => () => Promise<void>;
	}) => Promise<{ ok: boolean; targetTaskId?: string; message?: string }>;
	prepareWaitForTerminalConnectionReady: (taskId: string) => () => Promise<void>;
	sendTaskSessionInput: (
		taskId: string,
		text: string,
		options?: SendTerminalInputOptions,
	) => Promise<{ ok: boolean; message?: string }>;
}

interface UseShortcutActionsResult {
	runningShortcutLabel: string | null;
	handleSelectShortcutLabel: (shortcutLabel: string) => void;
	handleRunShortcut: (shortcutLabel: string) => Promise<void>;
}

export function useShortcutActions({
	currentProjectId,
	selectedShortcutLabel,
	shortcuts,
	refreshRuntimeProjectConfig,
	prepareTerminalForShortcut,
	prepareWaitForTerminalConnectionReady,
	sendTaskSessionInput,
}: UseShortcutActionsInput): UseShortcutActionsResult {
	const [runningShortcutLabel, setRunningShortcutLabel] = useState<string | null>(null);

	const saveSelectedShortcutPreference = useCallback(
		async (nextShortcutLabel: string | null): Promise<boolean> => {
			if (!currentProjectId) {
				return false;
			}
			try {
				await saveRuntimeConfig(currentProjectId, {
					selectedShortcutLabel: nextShortcutLabel,
				});
				refreshRuntimeProjectConfig();
				return true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast(
					{
						intent: "danger",
						icon: "error",
						message: `Could not save shortcut selection: ${message}`,
						timeout: 5000,
					},
					"shortcut-selection-save-failed",
				);
				return false;
			}
		},
		[currentProjectId, refreshRuntimeProjectConfig],
	);

	const handleSelectShortcutLabel = useCallback(
		(shortcutLabel: string) => {
			if (shortcutLabel === selectedShortcutLabel) {
				return;
			}
			void saveSelectedShortcutPreference(shortcutLabel);
		},
		[saveSelectedShortcutPreference, selectedShortcutLabel],
	);

	const handleRunShortcut = useCallback(
		async (shortcutLabel: string) => {
			const shortcut = shortcuts.find((item) => item.label === shortcutLabel);
			if (!shortcut || !currentProjectId) {
				return;
			}

			setRunningShortcutLabel(shortcutLabel);
			try {
				const prepared = await prepareTerminalForShortcut({
					prepareWaitForTerminalConnectionReady,
				});
				if (!prepared.ok || !prepared.targetTaskId) {
					throw new Error(prepared.message ?? "Could not open terminal.");
				}
				const runResult = await sendTaskSessionInput(prepared.targetTaskId, shortcut.command, {
					appendNewline: true,
				});
				if (!runResult.ok) {
					throw new Error(runResult.message ?? "Could not run shortcut command.");
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast(
					{
						intent: "danger",
						icon: "error",
						message: `Could not run shortcut "${shortcut.label}": ${message}`,
						timeout: 6000,
					},
					`shortcut-run-failed:${shortcut.label}`,
				);
			} finally {
				setRunningShortcutLabel(null);
			}
		},
		[
			currentProjectId,
			prepareTerminalForShortcut,
			prepareWaitForTerminalConnectionReady,
			sendTaskSessionInput,
			shortcuts,
		],
	);

	return {
		runningShortcutLabel,
		handleSelectShortcutLabel,
		handleRunShortcut,
	};
}
