import { useState } from "react";

import { useDocumentEvent } from "@/kanban/utils/react-use";

export function useDocumentVisibility(): boolean {
	const [isDocumentVisible, setIsDocumentVisible] = useState<boolean>(() => {
		if (typeof document === "undefined") {
			return true;
		}
		return document.visibilityState === "visible";
	});

	useDocumentEvent("visibilitychange", () => {
		setIsDocumentVisible(document.visibilityState === "visible");
	});

	return isDocumentVisible;
}
