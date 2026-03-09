import posthog from "posthog-js";

import type { RuntimeAgentId } from "@/runtime/types";
import type { TaskAutoReviewMode } from "@/types";
import { isTelemetryEnabled } from "@/telemetry/posthog-config";

interface TelemetryEventMap {
	task_created: {
		selected_agent_id: RuntimeAgentId | "unknown";
		start_in_plan_mode: boolean;
		auto_review_mode?: TaskAutoReviewMode;
		prompt_character_count: number;
	};
	task_dependency_created: Record<string, never>;
	task_resumed_from_trash: Record<string, never>;
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

export function trackTaskDependencyCreated(): void {
	captureTelemetryEvent("task_dependency_created", {});
}

export function trackTaskResumedFromTrash(): void {
	captureTelemetryEvent("task_resumed_from_trash", {});
}
