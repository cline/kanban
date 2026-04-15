import { describe, expect, it } from "vitest";

import { type DiffHighlightRange, formatSnippetReference } from "./diff-selection-toolbar";

describe("formatSnippetReference", () => {
	it("formats a single-line range with file:line", () => {
		const range: DiffHighlightRange = {
			filePath: "src/utils/foo.ts",
			startLine: 5,
			endLine: 5,
			text: "const x = 1;",
		};
		expect(formatSnippetReference(range)).toBe("src/utils/foo.ts:5\n```\nconst x = 1;\n```");
	});

	it("formats a multi-line range with file:start-end", () => {
		const range: DiffHighlightRange = {
			filePath: "src/utils/foo.ts",
			startLine: 5,
			endLine: 12,
			text: "const x = 1;\nconst y = 2;",
		};
		expect(formatSnippetReference(range)).toBe("src/utils/foo.ts:5-12\n```\nconst x = 1;\nconst y = 2;\n```");
	});

	it("handles empty text gracefully", () => {
		const range: DiffHighlightRange = {
			filePath: "index.ts",
			startLine: 1,
			endLine: 1,
			text: "",
		};
		expect(formatSnippetReference(range)).toBe("index.ts:1\n```\n\n```");
	});

	it("preserves file paths with deep nesting", () => {
		const range: DiffHighlightRange = {
			filePath: "web-ui/src/components/detail-panels/diff-viewer-panel.tsx",
			startLine: 100,
			endLine: 150,
			text: "// some code",
		};
		const result = formatSnippetReference(range);
		expect(result).toContain("web-ui/src/components/detail-panels/diff-viewer-panel.tsx:100-150");
	});
});
