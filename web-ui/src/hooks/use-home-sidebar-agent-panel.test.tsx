import { describe, expect, it } from "vitest";

import { selectNewestTaskSessionSummary } from "@/hooks/home-sidebar-agent-panel-session-summary";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";

function createSummary(state: RuntimeTaskSessionSummary["state"], updatedAt: number): RuntimeTaskSessionSummary {
	return {
		taskId: "__home_agent__:workspace:cline",
		state,
		agentId: "cline",
		workspacePath: "/tmp/repo",
		pid: null,
		startedAt: 1,
		updatedAt,
		lastOutputAt: updatedAt,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}

describe("selectNewestTaskSessionSummary", () => {
	it("prefers the newer summary when the home sidebar session finishes after starting", () => {
		const localRunningSummary = createSummary("running", 10);
		const streamedIdleSummary = createSummary("idle", 20);

		expect(selectNewestTaskSessionSummary(localRunningSummary, streamedIdleSummary)).toEqual(streamedIdleSummary);
	});

	it("ignores a stale replayed summary when the live home sidebar session is newer", () => {
		const liveRunningSummary = createSummary("running", 20);
		const staleInterruptedSummary = createSummary("interrupted", 10);

		expect(selectNewestTaskSessionSummary(liveRunningSummary, staleInterruptedSummary)).toEqual(liveRunningSummary);
	});

	it("keeps the available summary when only one source has session state", () => {
		const localRunningSummary = createSummary("running", 10);

		expect(selectNewestTaskSessionSummary(localRunningSummary, null)).toEqual(localRunningSummary);
		expect(selectNewestTaskSessionSummary(null, localRunningSummary)).toEqual(localRunningSummary);
	});
});
