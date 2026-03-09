import posthog from "posthog-js";

import type { RuntimeAgentId } from "@/runtime/types";
import { isTelemetryEnabled } from "@/telemetry/posthog-config";

interface TelemetryEventMap {
	task_created: {
		selected_agent_id: RuntimeAgentId | "unknown";
		start_in_plan_mode: boolean;
		prompt_character_count: number;
	};
}

function captureTelemetryEvent<EventName extends keyof TelemetryEventMap>(
	eventName: EventName,
	properties: TelemetryEventMap[EventName],
): void {
	if (!isTelemetryEnabled()) {
		return;
	}

	try {
		posthog.capture(eventName, properties);
	} catch {
		// Telemetry failures should never block user actions.
	}
}

export function trackTaskCreated(properties: TelemetryEventMap["task_created"]): void {
	captureTelemetryEvent("task_created", properties);
}
