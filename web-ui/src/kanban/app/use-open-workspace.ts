import { useCallback, useMemo, useState } from "react";

import { showAppToast } from "@/kanban/components/app-toaster";
import { useRawLocalStorageValue } from "@/kanban/utils/react-use";
import { getRuntimeTrpcClient } from "@/kanban/runtime/trpc-client";
import {
	buildOpenCommand,
	getOpenTargetOption,
	getOpenTargetOptions,
	normalizeOpenTargetId,
	type OpenTargetId,
	type OpenTargetOption,
	PREFERRED_OPEN_TARGET_STORAGE_KEY,
} from "@/kanban/utils/open-targets";

const OPEN_TARGET_OPTIONS = getOpenTargetOptions();

interface UseOpenWorkspaceParams {
	currentProjectId: string | null;
	workspacePath?: string;
}

interface UseOpenWorkspaceResult {
	openTargetOptions: readonly OpenTargetOption[];
	selectedOpenTargetId: OpenTargetId;
	onSelectOpenTarget: (targetId: OpenTargetId) => void;
	onOpenWorkspace: () => void;
	canOpenWorkspace: boolean;
	isOpeningWorkspace: boolean;
}

function getFirstOutputLine(output: string): string | null {
	return (
		output
			.split("\n")
			.map((line) => line.trim())
			.find(Boolean) ?? null
	);
}

export function useOpenWorkspace({ currentProjectId, workspacePath }: UseOpenWorkspaceParams): UseOpenWorkspaceResult {
	const [preferredOpenTargetId, setPreferredOpenTargetId] = useRawLocalStorageValue<OpenTargetId>(
		PREFERRED_OPEN_TARGET_STORAGE_KEY,
		"vscode",
		(value) => normalizeOpenTargetId(value),
	);
	const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);
	const selectedOpenTarget = useMemo(() => getOpenTargetOption(preferredOpenTargetId), [preferredOpenTargetId]);
	const canOpenWorkspace = Boolean(currentProjectId && workspacePath);

	const onSelectOpenTarget = useCallback(
		(targetId: OpenTargetId) => {
			setPreferredOpenTargetId(targetId);
		},
		[setPreferredOpenTargetId],
	);

	const showOpenFailureToast = useCallback(
		(message: string) => {
			showAppToast(
				{
					intent: "danger",
					icon: "error",
					message: `Could not open in ${selectedOpenTarget.label}: ${message}`,
					timeout: 6000,
				},
				"open-workspace-failed",
			);
		},
		[selectedOpenTarget.label],
	);

	const onOpenWorkspace = useCallback(() => {
		if (isOpeningWorkspace || !currentProjectId || !workspacePath) {
			return;
		}

		void (async () => {
			setIsOpeningWorkspace(true);
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.runtime.runShortcut.mutate({
					command: buildOpenCommand(preferredOpenTargetId, workspacePath),
				});
				if (payload.exitCode !== 0) {
					const details = getFirstOutputLine(payload.combinedOutput) ?? `Exited with code ${payload.exitCode}.`;
					showOpenFailureToast(details);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showOpenFailureToast(message);
			} finally {
				setIsOpeningWorkspace(false);
			}
		})();
	}, [currentProjectId, isOpeningWorkspace, preferredOpenTargetId, showOpenFailureToast, workspacePath]);

	return {
		openTargetOptions: OPEN_TARGET_OPTIONS,
		selectedOpenTargetId: selectedOpenTarget.id,
		onSelectOpenTarget,
		onOpenWorkspace,
		canOpenWorkspace,
		isOpeningWorkspace,
	};
}
