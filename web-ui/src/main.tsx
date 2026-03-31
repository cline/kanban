import type { ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";

import App from "@/App";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuthGate } from "@/hooks/use-auth-gate";
import { LoginPage } from "@/pages/login-page";
import { TelemetryProvider } from "@/telemetry/posthog-provider";
import { initializeSentry } from "@/telemetry/sentry";
import "@/styles/globals.css";

initializeSentry();

// AuthGate wraps the entire App so that none of App's hooks (WebSocket,
// tRPC, project navigation) fire until authentication is confirmed.
// This prevents the flood of 401 errors when the app first loads on a
// remote connection.
function AuthGate(): ReactElement {
	const { status: authStatus, identity } = useAuthGate();

	if (authStatus === "loading") {
		return (
			<div className="flex min-h-screen items-center justify-center bg-surface-0">
				<Spinner size={20} />
			</div>
		);
	}

	if (authStatus === "unauthenticated") {
		return <LoginPage onSuccess={() => window.location.reload()} />;
	}

	return <App identity={identity} />;
}

const root = document.getElementById("root");
if (!root) {
	throw new Error("Root element was not found.");
}

ReactDOM.createRoot(root).render(
	<TelemetryProvider>
		<AppErrorBoundary>
			<TooltipProvider>
				<AuthGate />
				<Toaster
					theme="dark"
					position="bottom-right"
					toastOptions={{
						style: {
							background: "var(--color-surface-1)",
							border: "1px solid var(--color-border)",
							color: "var(--color-text-primary)",
							fontSize: "13px",
							whiteSpace: "pre-line",
						},
					}}
				/>
			</TooltipProvider>
		</AppErrorBoundary>
	</TelemetryProvider>,
);
