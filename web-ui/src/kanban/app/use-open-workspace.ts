import { useCallback, useMemo, useState } from "react";

import { showAppToast } from "@/kanban/components/app-toaster";
import type { RuntimeShortcutRunResponse } from "@/kanban/runtime/types";
import { workspaceFetch } from "@/kanban/runtime/workspace-fetch";
import {
	buildOpenCommand,
	getOpenTargetOption,
	getOpenTargetOptions,
	loadPersistedOpenTarget,
	persistOpenTarget,
	type OpenTargetId,
	type OpenTargetOption,
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

type OpenWorkspacePayload =
	| RuntimeShortcutRunResponse
	| {
		error?: string;
	}
	| null;

function getOpenWorkspaceFailureMessage(payload: OpenWorkspacePayload, statusCode: number): string {
	if (payload && "error" in payload && typeof payload.error === "string" && payload.error) {
		return payload.error;
	}
	return `Open command failed with ${statusCode}.`;
}

function getFirstOutputLine(output: string): string | null {
	return output.split("\n").map((line) => line.trim()).find(Boolean) ?? null;
}

export function useOpenWorkspace({
	currentProjectId,
	workspacePath,
}: UseOpenWorkspaceParams): UseOpenWorkspaceResult {
	const [preferredOpenTargetId, setPreferredOpenTargetId] = useState<OpenTargetId>(() =>
		loadPersistedOpenTarget(),
	);
	const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);
	const selectedOpenTarget = useMemo(
		() => getOpenTargetOption(preferredOpenTargetId),
		[preferredOpenTargetId],
	);
	const canOpenWorkspace = Boolean(currentProjectId && workspacePath);

	const onSelectOpenTarget = useCallback((targetId: OpenTargetId) => {
		setPreferredOpenTargetId(targetId);
		persistOpenTarget(targetId);
	}, []);

	const showOpenFailureToast = useCallback((message: string) => {
		showAppToast(
			{
				intent: "danger",
				icon: "error",
				message: `Could not open in ${selectedOpenTarget.label}: ${message}`,
				timeout: 6000,
			},
			"open-workspace-failed",
		);
	}, [selectedOpenTarget.label]);

	const onOpenWorkspace = useCallback(() => {
		if (isOpeningWorkspace || !currentProjectId || !workspacePath) {
			return;
		}

		void (async () => {
			setIsOpeningWorkspace(true);
			try {
				const response = await workspaceFetch("/api/runtime/shortcut/run", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						command: buildOpenCommand(preferredOpenTargetId, workspacePath),
					}),
					workspaceId: currentProjectId,
				});
				const payload = (await response.json().catch(() => null)) as OpenWorkspacePayload;
				if (!response.ok || !payload || !("exitCode" in payload)) {
					showOpenFailureToast(getOpenWorkspaceFailureMessage(payload, response.status));
					return;
				}
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
	}, [
		currentProjectId,
		isOpeningWorkspace,
		preferredOpenTargetId,
		showOpenFailureToast,
		workspacePath,
	]);

	return {
		openTargetOptions: OPEN_TARGET_OPTIONS,
		selectedOpenTargetId: selectedOpenTarget.id,
		onSelectOpenTarget,
		onOpenWorkspace,
		canOpenWorkspace,
		isOpeningWorkspace,
	};
}
