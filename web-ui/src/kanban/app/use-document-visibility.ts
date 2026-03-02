import { useEffect, useState } from "react";

export function useDocumentVisibility(): boolean {
	const [isDocumentVisible, setIsDocumentVisible] = useState<boolean>(() => {
		if (typeof document === "undefined") {
			return true;
		}
		return document.visibilityState === "visible";
	});

	useEffect(() => {
		if (typeof document === "undefined") {
			return;
		}
		const handleVisibilityChange = () => {
			setIsDocumentVisible(document.visibilityState === "visible");
		};
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, []);

	return isDocumentVisible;
}
