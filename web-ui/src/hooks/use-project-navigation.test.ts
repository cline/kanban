import { describe, expect, it } from "vitest";

import { parseRemovedProjectPathFromStreamError } from "@/hooks/use-project-navigation";

describe("parseRemovedProjectPathFromStreamError", () => {
	it("extracts removed project paths", () => {
		expect(
			parseRemovedProjectPathFromStreamError("Project no longer exists on disk and was removed: /tmp/project"),
		).toBe("/tmp/project");
	});

	it("returns null when prefix is not present", () => {
		expect(parseRemovedProjectPathFromStreamError("Something else happened")).toBeNull();
	});
});
