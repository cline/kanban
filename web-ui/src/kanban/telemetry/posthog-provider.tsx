import { PostHogProvider } from "@posthog/react";
import type { ReactElement, ReactNode } from "react";

import { isTelemetryEnabled, posthogApiKey, posthogOptions } from "@/kanban/telemetry/posthog-config";

export function TelemetryProvider({ children }: { children: ReactNode }): ReactElement {
	if (!isTelemetryEnabled() || !posthogApiKey) {
		return <>{children}</>;
	}

	return (
		<PostHogProvider apiKey={posthogApiKey} options={posthogOptions}>
			{children}
		</PostHogProvider>
	);
}
