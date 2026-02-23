import { OverlayToaster, Position, type ToastProps, type Toaster } from "@blueprintjs/core";

let toasterPromise: Promise<Toaster> | null = null;

async function getAppToaster(): Promise<Toaster | null> {
	if (typeof document === "undefined") {
		return null;
	}
	if (!toasterPromise) {
		toasterPromise = OverlayToaster.create({
			position: Position.BOTTOM_RIGHT,
			maxToasts: 4,
		});
	}
	return await toasterPromise;
}

export function showAppToast(props: ToastProps, key?: string): void {
	void (async () => {
		const toaster = await getAppToaster();
		toaster?.show(props, key);
	})();
}
