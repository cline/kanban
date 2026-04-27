import type { ReactElement } from "react";

import { UpdateAvailableDialog } from "@/components/update-available-dialog";
import { useUpdateNotification } from "@/hooks/use-update-notification";

export function UpdateNotificationController(): ReactElement | null {
	const { availableUpdate, dismiss } = useUpdateNotification();

	if (!availableUpdate) {
		return null;
	}

	return (
		<UpdateAvailableDialog
			open
			currentVersion={availableUpdate.currentVersion}
			latestVersion={availableUpdate.latestVersion}
			installCommand={availableUpdate.installCommand}
			onClose={dismiss}
		/>
	);
}
