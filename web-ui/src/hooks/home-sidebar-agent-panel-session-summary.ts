import type { RuntimeTaskSessionSummary } from "@/runtime/types";

export function selectNewestTaskSessionSummary(
	left: RuntimeTaskSessionSummary | null,
	right: RuntimeTaskSessionSummary | null,
): RuntimeTaskSessionSummary | null {
	if (!left) {
		return right;
	}
	if (!right) {
		return left;
	}
	return left.updatedAt >= right.updatedAt ? left : right;
}
