import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";

import App from "@/App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TelemetryProvider } from "@/telemetry/posthog-provider";
import "@/styles/globals.css";

const root = document.getElementById("root");
if (!root) {
	throw new Error("Root element was not found.");
}

ReactDOM.createRoot(root).render(
	<TelemetryProvider>
		<TooltipProvider>
			<App />
			<Toaster
				theme="dark"
				position="bottom-right"
				toastOptions={{
					style: {
						background: "var(--color-surface-1)",
						border: "1px solid var(--color-border)",
						color: "var(--color-text-primary)",
						fontSize: "13px",
					},
				}}
			/>
		</TooltipProvider>
	</TelemetryProvider>,
);
