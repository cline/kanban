import { describe, expect, it } from "vitest";

import { getTaskAutoReviewActionLabel, getTaskAutoReviewCancelButtonLabel } from "@/types";

describe("getTaskAutoReviewActionLabel", () => {
	it("returns the expected label for each auto review mode", () => {
		expect(getTaskAutoReviewActionLabel("commit")).toBe("commit");
		expect(getTaskAutoReviewActionLabel("pr")).toBe("PR");
	});

	it("falls back to commit when the mode is missing", () => {
		expect(getTaskAutoReviewActionLabel(undefined)).toBe("commit");
	});

	it("returns the expected cancel button label for each auto review mode", () => {
		expect(getTaskAutoReviewCancelButtonLabel("commit")).toBe("Cancel Auto-commit");
		expect(getTaskAutoReviewCancelButtonLabel("pr")).toBe("Cancel Auto-PR");
	});
});
