import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";

import App from "@/App";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { TelemetryProvider } from "@/telemetry/posthog-provider";
import { initializeSentry } from "@/telemetry/sentry";
import "@/styles/globals.css";

initializeSentry();

const root = document.getElementById("root");
if (!root) {
	throw new Error("Root element was not found.");
}

ReactDOM.createRoot(root).render(
	<ThemeProvider>
		<TelemetryProvider>
			<AppErrorBoundary>
				<TooltipProvider>
					<InnerApp />
				</TooltipProvider>
			</AppErrorBoundary>
		</TelemetryProvider>
	</ThemeProvider>,
);

function InnerApp() {
	return (
		<>
			<App />
			<SonnerToaster />
		</>
	);
}

function SonnerToaster() {
	const toasterBackground = "var(--color-surface-1)";
	const toasterBorder = "var(--color-border)";
	const toasterColor = "var(--color-text-primary)";

	return (
		<Toaster
			theme="dark"
			position="bottom-right"
			toastOptions={{
				style: {
					background: toasterBackground,
					border: toasterBorder,
					color: toasterColor,
					fontSize: "13px",
					whiteSpace: "pre-line",
				},
			}}
		/>
	);
}
