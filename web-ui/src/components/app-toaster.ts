import { toast } from "sonner";

interface AppToastProps {
	intent?: "danger" | "warning" | "success" | "primary" | "none";
	icon?: string;
	message: string;
	timeout?: number;
}

export function showAppToast(props: AppToastProps, key?: string): void {
	const options: Parameters<typeof toast>[1] = {
		id: key,
		duration: props.timeout ?? 5000,
	};

	if (props.intent === "danger") {
		toast.error(props.message, options);
	} else if (props.intent === "warning") {
		toast.warning(props.message, options);
	} else if (props.intent === "success") {
		toast.success(props.message, options);
	} else {
		toast(props.message, options);
	}
}
