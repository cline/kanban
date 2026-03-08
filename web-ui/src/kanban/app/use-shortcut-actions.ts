import { useCallback, useState } from "react";

import { showAppToast } from "@/kanban/components/app-toaster";
import { saveRuntimeConfig } from "@/kanban/runtime/runtime-config-query";

interface RuntimeShortcut {
	id: string;
	label: string;
	command: string;
}

interface UseShortcutActionsInput {
	currentProjectId: string | null;
	selectedShortcutId: string | null | undefined;
	shortcuts: RuntimeShortcut[];
	refreshRuntimeProjectConfig: () => void;
	prepareTerminalForShortcut: (input: {
		prepareWaitForTerminalConnectionReady: (taskId: string) => () => Promise<void>;
	}) => Promise<{ ok: boolean; targetTaskId?: string; message?: string }>;
	prepareWaitForTerminalConnectionReady: (taskId: string) => () => Promise<void>;
	sendTaskSessionInput: (
		taskId: string,
		text: string,
		options?: { appendNewline?: boolean },
	) => Promise<{ ok: boolean; message?: string }>;
}

interface UseShortcutActionsResult {
	runningShortcutId: string | null;
	handleSelectShortcutId: (shortcutId: string) => void;
	handleRunShortcut: (shortcutId: string) => Promise<void>;
}

export function useShortcutActions({
	currentProjectId,
	selectedShortcutId,
	shortcuts,
	refreshRuntimeProjectConfig,
	prepareTerminalForShortcut,
	prepareWaitForTerminalConnectionReady,
	sendTaskSessionInput,
}: UseShortcutActionsInput): UseShortcutActionsResult {
	const [runningShortcutId, setRunningShortcutId] = useState<string | null>(null);

	const saveSelectedShortcutPreference = useCallback(
		async (nextShortcutId: string | null): Promise<boolean> => {
			if (!currentProjectId) {
				return false;
			}
			try {
				await saveRuntimeConfig(currentProjectId, {
					selectedShortcutId: nextShortcutId,
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

	const handleSelectShortcutId = useCallback(
		(shortcutId: string) => {
			if (shortcutId === selectedShortcutId) {
				return;
			}
			void saveSelectedShortcutPreference(shortcutId);
		},
		[saveSelectedShortcutPreference, selectedShortcutId],
	);

	const handleRunShortcut = useCallback(
		async (shortcutId: string) => {
			const shortcut = shortcuts.find((item) => item.id === shortcutId);
			if (!shortcut || !currentProjectId) {
				return;
			}

			setRunningShortcutId(shortcutId);
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
					`shortcut-run-failed:${shortcut.id}`,
				);
			} finally {
				setRunningShortcutId(null);
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
		runningShortcutId,
		handleSelectShortcutId,
		handleRunShortcut,
	};
}
