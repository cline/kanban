// ── Keyboard shortcuts for panel tab navigation ──

import type { Dispatch } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import type { LayoutAction } from "./layoutReducer";
import type { PanelNode } from "./layoutTypes";

/**
 * Binds keyboard shortcuts for the focused panel:
 * - Ctrl+W / Cmd+W: close active tab
 * - Ctrl+Tab: next tab
 * - Ctrl+Shift+Tab: previous tab
 *
 * Shortcuts are only active when the panel element contains focus.
 */
export function useKeyboardNavigation(
	node: PanelNode,
	dispatch: Dispatch<LayoutAction>,
	panelRef: React.RefObject<HTMLElement | null>,
) {
	const hasFocus = () => {
		return panelRef.current?.contains(document.activeElement) ?? false;
	};

	// Close active tab
	useHotkeys(
		"mod+w",
		(e) => {
			e.preventDefault();
			const activeTab = node.tabs.find((t) => t.id === node.activeTabId);
			if (activeTab?.closable) {
				dispatch({ type: "REMOVE_TAB", panelId: node.id, tabId: activeTab.id });
			}
		},
		{ enabled: hasFocus, enableOnFormTags: true },
	);

	// Next tab
	useHotkeys(
		"ctrl+tab",
		(e) => {
			e.preventDefault();
			if (node.tabs.length < 2) return;
			const idx = node.tabs.findIndex((t) => t.id === node.activeTabId);
			const next = node.tabs[(idx + 1) % node.tabs.length];
			if (next) {
				dispatch({ type: "SET_ACTIVE_TAB", panelId: node.id, tabId: next.id });
			}
		},
		{ enabled: hasFocus, enableOnFormTags: true },
	);

	// Previous tab
	useHotkeys(
		"ctrl+shift+tab",
		(e) => {
			e.preventDefault();
			if (node.tabs.length < 2) return;
			const idx = node.tabs.findIndex((t) => t.id === node.activeTabId);
			const prev = node.tabs[(idx - 1 + node.tabs.length) % node.tabs.length];
			if (prev) {
				dispatch({ type: "SET_ACTIVE_TAB", panelId: node.id, tabId: prev.id });
			}
		},
		{ enabled: hasFocus, enableOnFormTags: true },
	);
}
