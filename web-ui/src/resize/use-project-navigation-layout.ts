import { useCallback, useState } from "react";

import { useLayoutResetEffect } from "@/resize/layout-customizations";
import { clampBetween } from "@/resize/resize-persistence";
import {
	getResizePreferenceDefaultValue,
	loadBooleanResizePreference,
	loadResizePreference,
	persistBooleanResizePreference,
	persistResizePreference,
	type ResizeBooleanPreference,
	type ResizeNumberPreference,
} from "@/resize/resize-preferences";
import { LocalStorageKey } from "@/storage/local-storage-store";

const SIDEBAR_MIN_EXPANDED_WIDTH = 200;
const SIDEBAR_MAX_EXPANDED_WIDTH = 600;
const SIDEBAR_DEFAULT_EXPANDED_WIDTH_FALLBACK = 280;
const BOARD_SURFACE_HORIZONTAL_PADDING_PX = 16;
const BOARD_SURFACE_COLUMN_GAPS_PX = 24;
const BOARD_SURFACE_HORIZONTAL_CHROME_PX = BOARD_SURFACE_HORIZONTAL_PADDING_PX + BOARD_SURFACE_COLUMN_GAPS_PX;

function getDefaultExpandedSidebarWidth(): number {
	if (typeof window === "undefined" || !Number.isFinite(window.innerWidth)) {
		return SIDEBAR_DEFAULT_EXPANDED_WIDTH_FALLBACK;
	}
	const proportionalWidth = Math.round((window.innerWidth - BOARD_SURFACE_HORIZONTAL_CHROME_PX) / 5);
	return clampBetween(proportionalWidth, SIDEBAR_MIN_EXPANDED_WIDTH, SIDEBAR_MAX_EXPANDED_WIDTH);
}

const SIDEBAR_WIDTH_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.ProjectNavigationPanelWidth,
	defaultValue: getDefaultExpandedSidebarWidth,
	normalize: (value) => clampBetween(value, SIDEBAR_MIN_EXPANDED_WIDTH, SIDEBAR_MAX_EXPANDED_WIDTH),
};

const SIDEBAR_COLLAPSED_PREFERENCE: ResizeBooleanPreference = {
	key: LocalStorageKey.ProjectNavigationPanelCollapsed,
	defaultValue: false,
};

export function useProjectNavigationLayout(): {
	isCollapsed: boolean;
	setExpandedSidebarWidth: (width: number) => void;
	setSidebarCollapsed: (collapsed: boolean) => void;
	sidebarWidth: number;
} {
	const [sidebarWidth, setSidebarWidthState] = useState(() => loadResizePreference(SIDEBAR_WIDTH_PREFERENCE));
	const [isCollapsed, setIsCollapsedState] = useState(() => loadBooleanResizePreference(SIDEBAR_COLLAPSED_PREFERENCE));

	const setSidebarCollapsed = useCallback((collapsed: boolean) => {
		setIsCollapsedState(persistBooleanResizePreference(SIDEBAR_COLLAPSED_PREFERENCE, collapsed));
	}, []);

	const setExpandedSidebarWidth = useCallback((width: number) => {
		setSidebarWidthState(persistResizePreference(SIDEBAR_WIDTH_PREFERENCE, width));
	}, []);

	useLayoutResetEffect(() => {
		setSidebarWidthState(getResizePreferenceDefaultValue(SIDEBAR_WIDTH_PREFERENCE));
		setIsCollapsedState(SIDEBAR_COLLAPSED_PREFERENCE.defaultValue);
	});

	return {
		sidebarWidth,
		setExpandedSidebarWidth,
		isCollapsed,
		setSidebarCollapsed,
	};
}
