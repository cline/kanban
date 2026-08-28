import { describe, expect, it } from "vitest";

import {
	RUNTIME_CARD_SUMMARY_MAX_CHARS,
	runtimeBoardCardSchema,
	runtimeCardSummarySchema,
} from "../../src/core/api-contract";

describe("card summary schema", () => {
	describe("runtimeCardSummarySchema", () => {
		it("validates automatic summary", () => {
			const summary = {
				content: "Completed successfully",
				source: "automatic" as const,
				sourceUpdatedAt: 1000,
				updatedAt: 2000,
			};

			const result = runtimeCardSummarySchema.safeParse(summary);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toEqual(summary);
			}
		});

		it("validates manual summary", () => {
			const summary = {
				content: "Manually edited",
				source: "manual" as const,
				updatedAt: 2000,
			};

			const result = runtimeCardSummarySchema.safeParse(summary);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.source).toBe("manual");
			}
		});

		it("rejects invalid source", () => {
			const summary = {
				content: "Test",
				source: "invalid",
				updatedAt: 2000,
			};

			const result = runtimeCardSummarySchema.safeParse(summary);
			expect(result.success).toBe(false);
		});

		it("requires content and updatedAt", () => {
			const summary = {
				source: "automatic",
			};

			const result = runtimeCardSummarySchema.safeParse(summary);
			expect(result.success).toBe(false);
		});

		it("accepts summary at exact RUNTIME_CARD_SUMMARY_MAX_CHARS boundary", () => {
			const content = "x".repeat(RUNTIME_CARD_SUMMARY_MAX_CHARS);
			const summary = {
				content,
				source: "automatic" as const,
				updatedAt: 2000,
			};

			const result = runtimeCardSummarySchema.safeParse(summary);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.content.length).toBe(RUNTIME_CARD_SUMMARY_MAX_CHARS);
			}
		});

		it("rejects summary exceeding RUNTIME_CARD_SUMMARY_MAX_CHARS by 1", () => {
			const content = "x".repeat(RUNTIME_CARD_SUMMARY_MAX_CHARS + 1);
			const summary = {
				content,
				source: "automatic" as const,
				updatedAt: 2000,
			};

			const result = runtimeCardSummarySchema.safeParse(summary);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]?.message).toContain("2000");
			}
		});

		it("rejects summary significantly exceeding RUNTIME_CARD_SUMMARY_MAX_CHARS", () => {
			const content = "x".repeat(RUNTIME_CARD_SUMMARY_MAX_CHARS + 500);
			const summary = {
				content,
				source: "automatic" as const,
				updatedAt: 2000,
			};

			const result = runtimeCardSummarySchema.safeParse(summary);
			expect(result.success).toBe(false);
		});
	});

	describe("runtimeBoardCardSchema with summary", () => {
		it("accepts card without summary", () => {
			const card = {
				id: "test-1",
				prompt: "Test prompt",
				startInPlanMode: false,
				baseRef: "main",
				createdAt: 1000,
				updatedAt: 2000,
			};

			const result = runtimeBoardCardSchema.safeParse(card);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.summary).toBeUndefined();
			}
		});

		it("accepts card with valid summary", () => {
			const card = {
				id: "test-2",
				prompt: "Test prompt",
				startInPlanMode: false,
				baseRef: "main",
				createdAt: 1000,
				updatedAt: 2000,
				summary: {
					content: "Completed",
					source: "automatic" as const,
					updatedAt: 3000,
				},
			};

			const result = runtimeBoardCardSchema.safeParse(card);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.summary).toBeDefined();
			}
		});

		it("rejects card with invalid summary", () => {
			const card = {
				id: "test-3",
				prompt: "Test prompt",
				startInPlanMode: false,
				baseRef: "main",
				createdAt: 1000,
				updatedAt: 2000,
				summary: {
					content: "Invalid",
					source: "bad",
					updatedAt: 3000,
				},
			};

			const result = runtimeBoardCardSchema.safeParse(card);
			expect(result.success).toBe(false);
		});
	});
});
