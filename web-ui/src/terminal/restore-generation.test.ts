import { describe, expect, it } from "vitest";

import { shouldSkipWarmRestore } from "@/terminal/restore-generation";

const lastRestore = { generation: 3, cols: 80, rows: 24 };

describe("shouldSkipWarmRestore", () => {
	it("skips when generation and size already match the last apply", () => {
		expect(
			shouldSkipWarmRestore(lastRestore, {
				restoreGeneration: 3,
				cols: 80,
				rows: 24,
			}),
		).toBe(true);
	});

	it("applies when the restore generation is newer", () => {
		expect(
			shouldSkipWarmRestore(lastRestore, {
				restoreGeneration: 4,
				cols: 80,
				rows: 24,
			}),
		).toBe(false);
	});

	it("applies when cols or rows changed for the same generation", () => {
		expect(
			shouldSkipWarmRestore(lastRestore, {
				restoreGeneration: 3,
				cols: 120,
				rows: 24,
			}),
		).toBe(false);
	});

	it("applies when the server omitted restoreGeneration", () => {
		expect(
			shouldSkipWarmRestore(lastRestore, {
				cols: 80,
				rows: 24,
			}),
		).toBe(false);
	});

	it("applies when this viewer has not restored yet", () => {
		expect(
			shouldSkipWarmRestore(null, {
				restoreGeneration: 3,
				cols: 80,
				rows: 24,
			}),
		).toBe(false);
	});
});
