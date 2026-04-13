import { describe, expect, it } from "vitest";

import {
	normalizeServerPath,
	serverRootLabel,
	splitServerPath,
	toServerAbsolute,
	toUiRelative,
} from "@/utils/server-path";

describe("normalizeServerPath", () => {
	it("returns Unix paths unchanged", () => {
		expect(normalizeServerPath("/srv/projects")).toBe("/srv/projects");
	});

	it("converts Windows backslashes to forward slashes", () => {
		expect(normalizeServerPath("C:\\workspace\\repo")).toBe("C:/workspace/repo");
	});

	it("handles mixed separators", () => {
		expect(normalizeServerPath("C:\\workspace/repo\\sub")).toBe("C:/workspace/repo/sub");
	});

	it("returns empty string unchanged", () => {
		expect(normalizeServerPath("")).toBe("");
	});
});

describe("splitServerPath", () => {
	it("splits Unix paths", () => {
		expect(splitServerPath("/srv/projects/repo")).toEqual(["srv", "projects", "repo"]);
	});

	it("splits Windows paths (normalised)", () => {
		expect(splitServerPath("C:\\workspace\\repo")).toEqual(["C:", "workspace", "repo"]);
	});

	it("splits mixed paths", () => {
		expect(splitServerPath("/srv/projects\\repo/sub")).toEqual(["srv", "projects", "repo", "sub"]);
	});

	it("handles empty string", () => {
		expect(splitServerPath("")).toEqual([]);
	});

	it("handles path with trailing separators", () => {
		expect(splitServerPath("/srv/projects/")).toEqual(["srv", "projects"]);
	});

	it("handles Windows path with trailing separator", () => {
		expect(splitServerPath("C:\\workspace\\")).toEqual(["C:", "workspace"]);
	});
});

describe("toServerAbsolute", () => {
	it("joins Unix root with relative path", () => {
		expect(toServerAbsolute("/srv/projects", "repo/src")).toBe("/srv/projects/repo/src");
	});

	it("normalises Windows root and joins with /", () => {
		expect(toServerAbsolute("C:\\workspace", "repo\\src")).toBe("C:/workspace/repo/src");
	});

	it("handles trailing separator on root", () => {
		expect(toServerAbsolute("/srv/projects/", "repo")).toBe("/srv/projects/repo");
	});

	it("handles trailing backslash on Windows root", () => {
		expect(toServerAbsolute("C:\\workspace\\", "repo")).toBe("C:/workspace/repo");
	});

	it("handles empty relative path", () => {
		expect(toServerAbsolute("/srv/projects", "")).toBe("/srv/projects");
	});

	it("handles empty relative path for Windows root", () => {
		expect(toServerAbsolute("C:\\workspace", "")).toBe("C:/workspace");
	});

	it("handles relative path with forward slashes on Windows root", () => {
		expect(toServerAbsolute("C:\\workspace", "repo/src")).toBe("C:/workspace/repo/src");
	});
});

describe("toUiRelative", () => {
	it("strips Unix root prefix", () => {
		expect(toUiRelative("/srv/projects", "/srv/projects/repo/src")).toBe("repo/src");
	});

	it("strips Windows root prefix (normalised to /)", () => {
		expect(toUiRelative("C:\\workspace", "C:\\workspace\\repo\\src")).toBe("repo/src");
	});

	it("returns empty string when paths are equal", () => {
		expect(toUiRelative("/srv/projects", "/srv/projects")).toBe("");
	});

	it("returns empty string when Windows paths are equal", () => {
		expect(toUiRelative("C:\\workspace", "C:\\workspace")).toBe("");
	});

	it("handles root with trailing separator", () => {
		expect(toUiRelative("/srv/projects/", "/srv/projects/repo")).toBe("repo");
	});

	it("handles Windows root with trailing separator", () => {
		expect(toUiRelative("C:\\workspace\\", "C:\\workspace\\repo")).toBe("repo");
	});

	it("handles root without trailing separator against path with it", () => {
		expect(toUiRelative("/srv/projects", "/srv/projects/repo")).toBe("repo");
	});
});

describe("serverRootLabel", () => {
	it("returns / for Unix root paths", () => {
		expect(serverRootLabel("/srv/projects")).toBe("/");
	});

	it("returns drive prefix for Windows paths", () => {
		expect(serverRootLabel("C:\\workspace\\repo")).toBe("C:/");
	});

	it("returns drive prefix with slash for bare drive letter", () => {
		expect(serverRootLabel("C:")).toBe("C:/");
	});

	it("returns / for paths without drive letters", () => {
		expect(serverRootLabel("/home/user/projects")).toBe("/");
	});

	it("returns / for empty string", () => {
		expect(serverRootLabel("")).toBe("/");
	});
});
