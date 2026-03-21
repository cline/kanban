import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	toTelemetrySelectedAgentId,
	trackTaskCreated,
	trackTaskDependencyCreated,
	trackTaskResumedFromTrash,
	trackTasksAutoStartedFromDependency,
} from "@/telemetry/events";

const captureMock = vi.hoisted(() => vi.fn());
const isTelemetryEnabledMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("posthog-js", () => ({
	default: {
		capture: captureMock,
	},
}));

vi.mock("@/telemetry/posthog-config", () => ({
	isTelemetryEnabled: isTelemetryEnabledMock,
}));

describe("telemetry events", () => {
	beforeEach(() => {
		captureMock.mockReset();
		isTelemetryEnabledMock.mockReset();
		isTelemetryEnabledMock.mockReturnValue(true);
	});

	it("captures task creation with auto review metadata", () => {
		trackTaskCreated({
			selected_agent_id: "unknown",
			start_in_plan_mode: true,
			auto_review_mode: "pr",
			prompt_character_count: 42,
		});

		expect(captureMock).toHaveBeenCalledWith("task_created", {
			selected_agent_id: "unknown",
			start_in_plan_mode: true,
			auto_review_mode: "pr",
			prompt_character_count: 42,
		});
	});

	it("captures task creation without auto review metadata when automation is disabled", () => {
		trackTaskCreated({
			selected_agent_id: "unknown",
			start_in_plan_mode: false,
			prompt_character_count: 12,
		});

		expect(captureMock).toHaveBeenCalledWith("task_created", {
			selected_agent_id: "unknown",
			start_in_plan_mode: false,
			prompt_character_count: 12,
		});
	});

	it("captures the new task workflow events", () => {
		trackTaskDependencyCreated();
		trackTasksAutoStartedFromDependency(3);
		trackTaskResumedFromTrash();

		expect(captureMock).toHaveBeenNthCalledWith(1, "task_dependency_created", {});
		expect(captureMock).toHaveBeenNthCalledWith(2, "tasks_auto_started_from_dependency", {
			started_task_count: 3,
		});
		expect(captureMock).toHaveBeenNthCalledWith(3, "task_resumed_from_trash", {});
	});

	it("skips capture when telemetry is disabled", () => {
		isTelemetryEnabledMock.mockReturnValue(false);

		trackTaskDependencyCreated();

		expect(captureMock).not.toHaveBeenCalled();
	});

	it("normalizes nullable agent ids for telemetry", () => {
		expect(toTelemetrySelectedAgentId("codex")).toBe("codex");
		expect(toTelemetrySelectedAgentId(null)).toBe("unknown");
		expect(toTelemetrySelectedAgentId(undefined)).toBe("unknown");
	});
});
