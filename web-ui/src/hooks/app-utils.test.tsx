import { describe, expect, it } from "vitest";

import { buildDetailTaskUrl, parseDetailTaskIdFromSearch, parseLockedProjectIdFromSearch } from "@/hooks/app-utils";

describe("parseDetailTaskIdFromSearch", () => {
	it("returns the selected task id when present", () => {
		expect(parseDetailTaskIdFromSearch("?task=task-123")).toBe("task-123");
	});

	it("returns null when the task id is missing or blank", () => {
		expect(parseDetailTaskIdFromSearch("")).toBeNull();
		expect(parseDetailTaskIdFromSearch("?task=")).toBeNull();
		expect(parseDetailTaskIdFromSearch("?task=%20%20")).toBeNull();
	});
});

describe("buildDetailTaskUrl", () => {
	it("adds the task id while preserving other query params and hash", () => {
		expect(
			buildDetailTaskUrl({
				pathname: "/project-1",
				search: "?view=board",
				hash: "#panel",
				taskId: "task-123",
			}),
		).toBe("/project-1?view=board&task=task-123#panel");
	});

	it("removes the task id while preserving other query params", () => {
		expect(
			buildDetailTaskUrl({
				pathname: "/project-1",
				search: "?view=board&task=task-123",
				hash: "",
				taskId: null,
			}),
		).toBe("/project-1?view=board");
	});
});

describe("parseLockedProjectIdFromSearch", () => {
	it("returns the projectId when present", () => {
		expect(parseLockedProjectIdFromSearch("?projectId=project-abc")).toBe("project-abc");
	});

	it("returns projectId when mixed with other params", () => {
		expect(parseLockedProjectIdFromSearch("?view=board&projectId=proj-1&task=t1")).toBe("proj-1");
	});

	it("returns null when projectId is missing", () => {
		expect(parseLockedProjectIdFromSearch("")).toBeNull();
		expect(parseLockedProjectIdFromSearch("?view=board")).toBeNull();
	});

	it("returns null when projectId is empty or whitespace", () => {
		expect(parseLockedProjectIdFromSearch("?projectId=")).toBeNull();
		expect(parseLockedProjectIdFromSearch("?projectId=%20%20")).toBeNull();
		expect(parseLockedProjectIdFromSearch("?projectId=  ")).toBeNull();
	});

	it("trims whitespace from projectId", () => {
		expect(parseLockedProjectIdFromSearch("?projectId=%20abc%20")).toBe("abc");
	});
});
