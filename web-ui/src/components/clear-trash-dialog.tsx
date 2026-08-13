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

export function ClearTrashDialog({
	open,
	taskCount,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	taskCount: number;
	onCancel: () => void;
	onConfirm: () => void;
}): ReactElement {
	const { t } = useI18n();
	const taskLabel = t(taskCount === 1 ? "common.task" : "common.tasks");

	return (
		<AlertDialog
			open={open}
			onOpenChange={(isOpen) => {
				if (!isOpen) onCancel();
			}}
		>
			<AlertDialogHeader>
				<AlertDialogTitle>{t("clearDone.title")}</AlertDialogTitle>
			</AlertDialogHeader>
			<AlertDialogBody>
				<AlertDialogDescription>
					{t("clearDone.description", { count: taskCount, taskLabel })}
				</AlertDialogDescription>
				<p className="text-text-primary">{t("common.irreversible")}</p>
			</AlertDialogBody>
			<AlertDialogFooter>
				<AlertDialogCancel asChild>
					<Button variant="default" onClick={onCancel}>
						{t("common.cancel")}
					</Button>
				</AlertDialogCancel>
				<AlertDialogAction asChild>
					<Button variant="danger" onClick={onConfirm}>
						{t("clearDone.confirm")}
					</Button>
				</AlertDialogAction>
			</AlertDialogFooter>
		</AlertDialog>
	);
}
