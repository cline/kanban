import { describe, expect, it } from "vitest";

import { isCardDropDisabled, type ProgrammaticCardMoveInFlight } from "@/kanban/state/drag-rules";

describe("drag rules", () => {
	it("keeps manual in-progress to review drops disabled", () => {
		expect(isCardDropDisabled("review", "in_progress")).toBe(true);
	});

	it("allows the matching programmatic in-progress to review drop", () => {
		const move: ProgrammaticCardMoveInFlight = {
			taskId: "task-1",
			fromColumnId: "in_progress",
			toColumnId: "review",
			insertAtTop: true,
		};

		expect(
			isCardDropDisabled("review", "in_progress", {
				activeDragTaskId: "task-1",
				programmaticCardMoveInFlight: move,
			}),
		).toBe(false);
		expect(
			isCardDropDisabled("review", "in_progress", {
				activeDragTaskId: "task-2",
				programmaticCardMoveInFlight: move,
			}),
		).toBe(true);
	});

	it("allows the matching programmatic review to in-progress drop", () => {
		const move: ProgrammaticCardMoveInFlight = {
			taskId: "task-1",
			fromColumnId: "review",
			toColumnId: "in_progress",
			insertAtTop: true,
		};

		expect(
			isCardDropDisabled("in_progress", "review", {
				activeDragTaskId: "task-1",
				programmaticCardMoveInFlight: move,
			}),
		).toBe(false);
		expect(
			isCardDropDisabled("in_progress", "review", {
				activeDragTaskId: "task-1",
				programmaticCardMoveInFlight: {
					...move,
					toColumnId: "review",
				},
			}),
		).toBe(true);
	});

	it("allows manual trash to review drops", () => {
		expect(isCardDropDisabled("review", "trash")).toBe(false);
	});
});
