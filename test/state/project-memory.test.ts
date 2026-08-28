import { describe, expect, it } from "vitest";

import {
	getProjectMemoryMaxChars,
	readProjectMemory,
	updateProjectMemory,
	writeProjectMemory,
} from "../../src/state/project-memory";
import { createTempDir } from "../utilities/temp-dir";

async function withTemporaryHome<T>(run: () => Promise<T>): Promise<T> {
	const { path: tempHome, cleanup } = createTempDir("kanban-home-");
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	try {
		return await run();
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = previousUserProfile;
		}
		cleanup();
	}
}

describe("project-memory", () => {
	describe("getProjectMemoryMaxChars", () => {
		it("returns the configured maximum", () => {
			expect(getProjectMemoryMaxChars()).toBeGreaterThan(0);
		});
	});

	describe("readProjectMemory and writeProjectMemory", () => {
		it("serializes concurrent updates without losing content", async () => {
			await withTemporaryHome(async () => {
				const workspaceId = "test-workspace";
				await Promise.all([
					updateProjectMemory(workspaceId, (current) => `${current}\nfirst`.trim()),
					updateProjectMemory(workspaceId, (current) => `${current}\nsecond`.trim()),
				]);

				const result = await readProjectMemory(workspaceId);
				expect(result.type).toBe("success");
				if (result.type === "success") {
					expect(result.content).toContain("first");
					expect(result.content).toContain("second");
				}
			});
		});

		it("reads empty content when file does not exist", async () => {
			await withTemporaryHome(async () => {
				const workspaceId = "test-workspace";
				const result = await readProjectMemory(workspaceId);
				expect(result.type).toBe("success");
				if (result.type === "success") {
					expect(result.content).toBe("");
				}
			});
		});

		it("writes and reads back content", async () => {
			await withTemporaryHome(async () => {
				const workspaceId = "test-workspace";
				const content = "# Test Project Memory\n\nThis is test content.";

				const writeResult = await writeProjectMemory(workspaceId, content);
				expect(writeResult.type).toBe("success");
				if (writeResult.type === "success") {
					expect(writeResult.content).toBe(content);
				}

				const readResult = await readProjectMemory(workspaceId);
				expect(readResult.type).toBe("success");
				if (readResult.type === "success") {
					expect(readResult.content).toBe(content);
				}
			});
		});

		it("normalizes line endings", async () => {
			await withTemporaryHome(async () => {
				const workspaceId = "test-workspace";
				const contentWithWindowsLineEndings = "Line 1\r\nLine 2\r\nLine 3";

				const writeResult = await writeProjectMemory(workspaceId, contentWithWindowsLineEndings);
				expect(writeResult.type).toBe("success");

				const readResult = await readProjectMemory(workspaceId);
				expect(readResult.type).toBe("success");
				if (readResult.type === "success") {
					expect(readResult.content).toBe("Line 1\nLine 2\nLine 3");
				}
			});
		});

		it("trims content", async () => {
			await withTemporaryHome(async () => {
				const workspaceId = "test-workspace";
				const contentWithWhitespace = "  \n\n  Test content  \n\n  ";

				const writeResult = await writeProjectMemory(workspaceId, contentWithWhitespace);
				expect(writeResult.type).toBe("success");
				if (writeResult.type === "success") {
					expect(writeResult.content).toBe("Test content");
				}

				const readResult = await readProjectMemory(workspaceId);
				expect(readResult.type).toBe("success");
				if (readResult.type === "success") {
					expect(readResult.content).toBe("Test content");
				}
			});
		});

		it("supports empty content after trim", async () => {
			await withTemporaryHome(async () => {
				const workspaceId = "test-workspace";
				const emptyContent = "  \n\n  ";

				const writeResult = await writeProjectMemory(workspaceId, emptyContent);
				expect(writeResult.type).toBe("success");
				if (writeResult.type === "success") {
					expect(writeResult.content).toBe("");
				}

				const readResult = await readProjectMemory(workspaceId);
				expect(readResult.type).toBe("success");
				if (readResult.type === "success") {
					expect(readResult.content).toBe("");
				}
			});
		});

		it("rejects oversized content", async () => {
			await withTemporaryHome(async () => {
				const workspaceId = "test-workspace";
				const maxChars = getProjectMemoryMaxChars();
				const oversizedContent = "x".repeat(maxChars + 1);

				const writeResult = await writeProjectMemory(workspaceId, oversizedContent);
				expect(writeResult.type).toBe("validation_error");
				if (writeResult.type === "validation_error") {
					expect(writeResult.message).toContain("exceeds maximum size");
				}

				const readResult = await readProjectMemory(workspaceId);
				expect(readResult.type).toBe("success");
				if (readResult.type === "success") {
					expect(readResult.content).toBe("");
				}
			});
		});

		it("accepts content at exactly the maximum size", async () => {
			await withTemporaryHome(async () => {
				const workspaceId = "test-workspace";
				const maxChars = getProjectMemoryMaxChars();
				const exactContent = "x".repeat(maxChars);

				const writeResult = await writeProjectMemory(workspaceId, exactContent);
				expect(writeResult.type).toBe("success");
				if (writeResult.type === "success") {
					expect(writeResult.content.length).toBe(maxChars);
				}

				const readResult = await readProjectMemory(workspaceId);
				expect(readResult.type).toBe("success");
				if (readResult.type === "success") {
					expect(readResult.content.length).toBe(maxChars);
				}
			});
		});

		it("persists across reads", async () => {
			await withTemporaryHome(async () => {
				const workspaceId = "test-workspace";
				const content = "# Persistent Memory\n\nSome important context.";

				const writeResult = await writeProjectMemory(workspaceId, content);
				expect(writeResult.type).toBe("success");

				const readResult1 = await readProjectMemory(workspaceId);
				expect(readResult1.type).toBe("success");
				if (readResult1.type === "success") {
					expect(readResult1.content).toBe(content);
				}

				const readResult2 = await readProjectMemory(workspaceId);
				expect(readResult2.type).toBe("success");
				if (readResult2.type === "success") {
					expect(readResult2.content).toBe(content);
				}
			});
		});

		it("isolates memory per workspace", async () => {
			await withTemporaryHome(async () => {
				const workspaceId1 = "workspace-1";
				const workspaceId2 = "workspace-2";
				const content1 = "# Workspace 1 Memory";
				const content2 = "# Workspace 2 Memory";

				await writeProjectMemory(workspaceId1, content1);
				await writeProjectMemory(workspaceId2, content2);

				const readResult1 = await readProjectMemory(workspaceId1);
				expect(readResult1.type).toBe("success");
				if (readResult1.type === "success") {
					expect(readResult1.content).toBe(content1);
				}

				const readResult2 = await readProjectMemory(workspaceId2);
				expect(readResult2.type).toBe("success");
				if (readResult2.type === "success") {
					expect(readResult2.content).toBe(content2);
				}
			});
		});
	});
});
