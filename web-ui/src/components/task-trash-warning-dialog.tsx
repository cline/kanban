import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogBody,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n/i18n-context";
import type { TranslationKey, TranslationValues } from "@/i18n/translations";
import type { RuntimeTaskWorkspaceInfoResponse } from "@/runtime/types";
import { formatPathForDisplay } from "@/utils/path-display";

export interface TaskTrashWarningViewModel {
	taskTitle: string;
	fileCount: number;
	workspaceInfo: RuntimeTaskWorkspaceInfoResponse | null;
}

type Translate = (key: TranslationKey, values?: TranslationValues) => string;

function getTrashWarningGuidance(t: Translate, workspaceInfo: RuntimeTaskWorkspaceInfoResponse | null): string[] {
	if (!workspaceInfo) {
		return [t("task.guidance.saveChanges")];
	}

	if (workspaceInfo.isDetached) {
		return [t("task.guidance.detachedBranch"), t("task.guidance.detachedCherryPick")];
	}

	const branch = workspaceInfo.branch ?? workspaceInfo.baseRef;
	return [t("task.guidance.branch", { branch }), t("task.guidance.afterPreserving")];
}

export function TaskTrashWarningDialog({
	open,
	warning,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	warning: TaskTrashWarningViewModel | null;
	onCancel: () => void;
	onConfirm: () => void;
}): ReactElement {
	const { t } = useI18n();
	const guidance = getTrashWarningGuidance(t, warning?.workspaceInfo ?? null);
	const fileLabel = t((warning?.fileCount ?? 0) === 1 ? "common.file" : "common.files");

	return (
		<AlertDialog
			open={open}
			onOpenChange={(isOpen) => {
				if (!isOpen) onCancel();
			}}
		>
			<AlertDialogHeader>
				<AlertDialogTitle>{t("task.unsavedChangesTitle")}</AlertDialogTitle>
			</AlertDialogHeader>
			<AlertDialogBody>
				<AlertDialogDescription>
					{warning
						? t("task.changedFiles", {
								title: warning.taskTitle,
								count: warning.fileCount,
								fileLabel,
							})
						: t("task.uncommittedChanges")}
				</AlertDialogDescription>
				<p>{t("task.moveToDoneWarning")}</p>
				{warning?.workspaceInfo?.path ? (
					<pre className="overflow-auto rounded-md bg-surface-0 p-3 font-mono text-xs text-text-secondary whitespace-pre-wrap">
						{formatPathForDisplay(warning.workspaceInfo.path)}
					</pre>
				) : null}
				<div className="flex flex-col gap-1">
					{guidance.map((line) => (
						<p key={line}>{line}</p>
					))}
				</div>
			</AlertDialogBody>
			<AlertDialogFooter>
				<AlertDialogCancel asChild>
					<Button variant="default" onClick={onCancel}>
						{t("common.cancel")}
					</Button>
				</AlertDialogCancel>
				<AlertDialogAction asChild>
					<Button variant="danger" onClick={onConfirm}>
						{t("task.moveToDoneAnyway")}
					</Button>
				</AlertDialogAction>
			</AlertDialogFooter>
		</AlertDialog>
	);
}
