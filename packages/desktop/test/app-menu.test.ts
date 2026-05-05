import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Edit-menu role enabled-state
//
// Every role in the Edit menu (undo/redo/cut/copy/paste/selectAll) is
// implemented by Electron as a delegation to the focused webContents — they
// don't depend on the runtime URL being set. Gating them on the runtime
// connection state means a user landing on the disconnected screen can't
// even copy the error text, paste a config URL into a field, or use Cmd+C
// to grab a stack trace from the page.
//
// This is a structural test against the source: the Edit submenu must use
// the bare-role form (no `enabled:` modifier) for these six roles.
// ---------------------------------------------------------------------------

describe("AppMenu Edit submenu", () => {
	const appMenuSrc = readFileSync(
		new URL("../src/app-menu.ts", import.meta.url),
		"utf-8",
	);

	function extractEditSubmenu(): string {
		// The Edit submenu is defined as `const editMenu: ... = { ... };` —
		// scan from the label and pull out the array literal that follows
		// `submenu:`. We slice up to the next `};` since that's where the
		// const declaration ends.
		const startIdx = appMenuSrc.indexOf('label: "Edit"');
		expect(startIdx).toBeGreaterThan(-1);
		const endIdx = appMenuSrc.indexOf("};", startIdx);
		expect(endIdx).toBeGreaterThan(startIdx);
		return appMenuSrc.slice(startIdx, endIdx);
	}

	it.each([
		["undo"],
		["redo"],
		["cut"],
		["copy"],
		["paste"],
		["selectAll"],
	])("does not gate the %s role on runtime connection state", (role) => {
		const editSrc = extractEditSubmenu();
		// The role must appear (sanity check it's still in the menu).
		expect(editSrc).toContain(`role: "${role}"`);
		// And must NOT be paired with `enabled: ready` (or any other
		// runtime-derived flag).
		const banned = new RegExp(
			`role:\\s*"${role}"\\s*,\\s*enabled\\s*:`,
		);
		expect(editSrc).not.toMatch(banned);
	});
});
