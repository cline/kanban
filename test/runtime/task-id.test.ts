import { afterEach, describe, expect, it, vi } from "vitest";

import { createUniqueTaskId } from "../../src/core/task-id";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("createUniqueTaskId", () => {
	it("uses random entropy in the final fallback", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.123456789);

		const taskId = createUniqueTaskId(new Set(["moi4q"]), () => "moi4qabcdef");

		expect(taskId).toBe("4fzzz");
	});
});
