import { describe, expect, it } from "vitest";

import { getTaskAutoReviewActionLabel } from "@/kanban/types";

describe("getTaskAutoReviewActionLabel", () => {
	it("returns the expected label for each auto review mode", () => {
		expect(getTaskAutoReviewActionLabel("commit")).toBe("commit");
		expect(getTaskAutoReviewActionLabel("pr")).toBe("PR");
		expect(getTaskAutoReviewActionLabel("move_to_trash")).toBe("move to trash");
	});

	it("falls back to commit when the mode is missing", () => {
		expect(getTaskAutoReviewActionLabel(undefined)).toBe("commit");
	});
});
