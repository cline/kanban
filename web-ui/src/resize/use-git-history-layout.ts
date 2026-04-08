import { useCallback, useMemo, useState } from "react";

import { useLayoutResetEffect } from "@/resize/layout-customizations";
import { clampAtLeast, clampWidthToContainer } from "@/resize/resize-persistence";
import {
	getResizePreferenceDefaultValue,
	loadResizePreference,
	persistResizePreference,
	type ResizeNumberPreference,
} from "@/resize/resize-preferences";
import { LocalStorageKey } from "@/storage/local-storage-store";

export const MIN_GIT_REFS_PANEL_WIDTH = 180;
export const MIN_GIT_COMMITS_PANEL_WIDTH = 260;
export const MIN_GIT_DIFF_PANEL_WIDTH = 340;
export const GIT_HISTORY_SEPARATOR_COUNT = 2;

const REFS_PANEL_WIDTH_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.GitHistoryRefsPanelWidth,
	defaultValue: 220,
	normalize: (value) => clampAtLeast(value, MIN_GIT_REFS_PANEL_WIDTH, true),
};

const COMMITS_PANEL_WIDTH_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.GitHistoryCommitsPanelWidth,
	defaultValue: 360,
	normalize: (value) => clampAtLeast(value, MIN_GIT_COMMITS_PANEL_WIDTH, true),
};

export function clampGitRefsPanelWidth(width: number, containerWidth: number, commitsPanelWidth: number): number {
	return clampWidthToContainer({
		width,
		minWidth: MIN_GIT_REFS_PANEL_WIDTH,
		containerWidth,
		reservedWidth: commitsPanelWidth + MIN_GIT_DIFF_PANEL_WIDTH + GIT_HISTORY_SEPARATOR_COUNT,
	});
}

export function clampGitCommitsPanelWidth(width: number, containerWidth: number, refsPanelWidth: number): number {
	return clampWidthToContainer({
		width,
		minWidth: MIN_GIT_COMMITS_PANEL_WIDTH,
		containerWidth,
		reservedWidth: refsPanelWidth + MIN_GIT_DIFF_PANEL_WIDTH + GIT_HISTORY_SEPARATOR_COUNT,
	});
}

export function useGitHistoryLayout({ containerWidth }: { containerWidth: number | null }): {
	commitsPanelWidth: number;
	displayCommitsPanelWidth: number;
	displayRefsPanelWidth: number;
	refsPanelWidth: number;
	setCommitsPanelWidth: (width: number) => void;
	setRefsPanelWidth: (width: number) => void;
} {
	const [refsPanelWidth, setRefsPanelWidthState] = useState(() => loadResizePreference(REFS_PANEL_WIDTH_PREFERENCE));
	const [commitsPanelWidth, setCommitsPanelWidthState] = useState(() =>
		loadResizePreference(COMMITS_PANEL_WIDTH_PREFERENCE),
	);

	const setRefsPanelWidth = useCallback((width: number) => {
		setRefsPanelWidthState(persistResizePreference(REFS_PANEL_WIDTH_PREFERENCE, width));
	}, []);

	const setCommitsPanelWidth = useCallback((width: number) => {
		setCommitsPanelWidthState(persistResizePreference(COMMITS_PANEL_WIDTH_PREFERENCE, width));
	}, []);

	useLayoutResetEffect(() => {
		setRefsPanelWidthState(getResizePreferenceDefaultValue(REFS_PANEL_WIDTH_PREFERENCE));
		setCommitsPanelWidthState(getResizePreferenceDefaultValue(COMMITS_PANEL_WIDTH_PREFERENCE));
	});

	const { displayRefsPanelWidth, displayCommitsPanelWidth } = useMemo(() => {
		if (containerWidth === null || !Number.isFinite(containerWidth)) {
			return {
				displayRefsPanelWidth: refsPanelWidth,
				displayCommitsPanelWidth: commitsPanelWidth,
			};
		}

		const clampedCommitsPanelWidth = clampGitCommitsPanelWidth(commitsPanelWidth, containerWidth, refsPanelWidth);
		const clampedRefsPanelWidth = clampGitRefsPanelWidth(refsPanelWidth, containerWidth, clampedCommitsPanelWidth);

		return {
			displayRefsPanelWidth: clampedRefsPanelWidth,
			displayCommitsPanelWidth: clampedCommitsPanelWidth,
		};
	}, [commitsPanelWidth, containerWidth, refsPanelWidth]);

	return {
		refsPanelWidth,
		commitsPanelWidth,
		displayRefsPanelWidth,
		displayCommitsPanelWidth,
		setRefsPanelWidth,
		setCommitsPanelWidth,
	};
}
