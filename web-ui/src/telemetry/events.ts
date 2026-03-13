import posthog from "posthog-js";

import type { RuntimeAgentId } from "@/runtime/types";
import { isTelemetryEnabled } from "@/telemetry/posthog-config";
import type { TaskAutoReviewMode } from "@/types";

export type TelemetrySelectedAgentId = RuntimeAgentId | "unknown";
export type TaskStartSetupKind = "linear_mcp" | "github_cli";

interface TelemetryEventMap {
	task_created: {
		selected_agent_id: TelemetrySelectedAgentId;
		start_in_plan_mode: boolean;
		auto_review_mode?: TaskAutoReviewMode;
		prompt_character_count: number;
	};
	task_dependency_created: Record<string, never>;
	tasks_auto_started_from_dependency: {
		started_task_count: number;
	};
	task_resumed_from_trash: Record<string, never>;
	task_start_setup_prompt_viewed: {
		setup_kind: TaskStartSetupKind;
		selected_agent_id: TelemetrySelectedAgentId;
	};
	task_start_setup_install_command_clicked: {
		setup_kind: TaskStartSetupKind;
		selected_agent_id: TelemetrySelectedAgentId;
	};
}

export function toTelemetrySelectedAgentId(agentId: RuntimeAgentId | null | undefined): TelemetrySelectedAgentId {
	return agentId ?? "unknown";
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

export function trackTasksAutoStartedFromDependency(startedTaskCount: number): void {
	captureTelemetryEvent("tasks_auto_started_from_dependency", {
		started_task_count: startedTaskCount,
	});
}

export function trackTaskResumedFromTrash(): void {
	captureTelemetryEvent("task_resumed_from_trash", {});
}

export function trackTaskStartSetupPromptViewed(properties: TelemetryEventMap["task_start_setup_prompt_viewed"]): void {
	captureTelemetryEvent("task_start_setup_prompt_viewed", properties);
}

export function trackTaskStartSetupInstallCommandClicked(
	properties: TelemetryEventMap["task_start_setup_install_command_clicked"],
): void {
	captureTelemetryEvent("task_start_setup_install_command_clicked", properties);
}
