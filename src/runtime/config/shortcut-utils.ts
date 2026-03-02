import type { RuntimeProjectShortcut } from "../api-contract.js";

export function areRuntimeProjectShortcutsEqual(
	left: RuntimeProjectShortcut[],
	right: RuntimeProjectShortcut[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index += 1) {
		const leftItem = left[index];
		const rightItem = right[index];
		if (!leftItem || !rightItem) {
			return false;
		}
		if (
			leftItem.id !== rightItem.id ||
			leftItem.label !== rightItem.label ||
			leftItem.command !== rightItem.command ||
			(leftItem.icon ?? "") !== (rightItem.icon ?? "")
		) {
			return false;
		}
	}
	return true;
}
