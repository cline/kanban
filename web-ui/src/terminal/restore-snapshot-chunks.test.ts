import { describe, expect, it } from "vitest";

import { RESTORE_WRITE_CHUNK_BYTES, splitRestoreSnapshot } from "@/terminal/restore-snapshot-chunks";

describe("splitRestoreSnapshot", () => {
	it("returns no writes for an empty snapshot", () => {
		expect(splitRestoreSnapshot("")).toEqual([]);
	});

	it("keeps a snapshot that fits in one parse budget as one write", () => {
		const snapshot = "a".repeat(RESTORE_WRITE_CHUNK_BYTES);

		expect(splitRestoreSnapshot(snapshot)).toEqual([snapshot]);
	});

	it("splits one byte over the parse budget into two writes", () => {
		const snapshot = "a".repeat(RESTORE_WRITE_CHUNK_BYTES + 1);

		const chunks = splitRestoreSnapshot(snapshot);

		expect(chunks).toHaveLength(2);
		expect(chunks[0]).toHaveLength(RESTORE_WRITE_CHUNK_BYTES);
		expect(chunks[1]).toBe("a");
		expect(chunks.join("")).toBe(snapshot);
	});

	it("joins back to the original snapshot with no drop or reorder", () => {
		const snapshot = `${"ab".repeat(10_000)}🙂${"cd".repeat(8_000)}`;

		expect(splitRestoreSnapshot(snapshot).join("")).toBe(snapshot);
	});
});
