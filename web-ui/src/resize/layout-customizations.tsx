import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { resetLayoutCustomizationLocalStorageItems } from "@/storage/local-storage-store";

interface LayoutCustomizationsContextValue {
	layoutResetNonce: number;
	resetLayoutCustomizations: () => void;
}

const LayoutCustomizationsContext = createContext<LayoutCustomizationsContextValue | null>(null);

export function LayoutCustomizationsProvider({
	children,
	onResetBottomTerminalLayoutCustomizations,
}: {
	children: ReactNode;
	onResetBottomTerminalLayoutCustomizations: () => void;
}): React.ReactElement {
	const [layoutResetNonce, setLayoutResetNonce] = useState(0);

	const resetLayoutCustomizations = useCallback(() => {
		resetLayoutCustomizationLocalStorageItems();
		onResetBottomTerminalLayoutCustomizations();
		setLayoutResetNonce((current) => current + 1);
		showAppToast(
			{
				intent: "success",
				message: "Layout reset to defaults.",
				timeout: 3000,
			},
			"layout-reset",
		);
	}, [onResetBottomTerminalLayoutCustomizations]);

	const value = useMemo(
		() => ({
			layoutResetNonce,
			resetLayoutCustomizations,
		}),
		[layoutResetNonce, resetLayoutCustomizations],
	);

	return <LayoutCustomizationsContext.Provider value={value}>{children}</LayoutCustomizationsContext.Provider>;
}

export function useLayoutCustomizations(): LayoutCustomizationsContextValue {
	const value = useContext(LayoutCustomizationsContext);
	if (!value) {
		throw new Error("useLayoutCustomizations must be used within a LayoutCustomizationsProvider.");
	}
	return value;
}

export function useLayoutResetEffect(onReset: () => void): void {
	const { layoutResetNonce } = useLayoutCustomizations();
	const onResetRef = useRef(onReset);
	const hasMountedRef = useRef(false);

	useEffect(() => {
		onResetRef.current = onReset;
	}, [onReset]);

	useEffect(() => {
		if (!hasMountedRef.current) {
			hasMountedRef.current = true;
			return;
		}
		onResetRef.current();
	}, [layoutResetNonce]);
}
