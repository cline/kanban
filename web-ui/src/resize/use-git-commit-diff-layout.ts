import { useCallback, useState } from "react";

import { useLayoutResetEffect } from "@/resize/layout-customizations";
import { clampBetween } from "@/resize/resize-persistence";
import {
	getResizePreferenceDefaultValue,
	loadResizePreference,
	persistResizePreference,
	type ResizeNumberPreference,
} from "@/resize/resize-preferences";
import { LocalStorageKey } from "@/storage/local-storage-store";

const FILE_TREE_RATIO_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.GitDiffFileTreePanelRatio,
	defaultValue: 0.375,
	normalize: (value) => clampBetween(value, 0.12, 0.6),
};

export function useGitCommitDiffLayout(): {
	fileTreePanelRatio: number;
	setFileTreePanelRatio: (ratio: number) => void;
} {
	const [fileTreePanelRatio, setFileTreePanelRatioState] = useState(() =>
		loadResizePreference(FILE_TREE_RATIO_PREFERENCE),
	);

	const setFileTreePanelRatio = useCallback((ratio: number) => {
		setFileTreePanelRatioState(persistResizePreference(FILE_TREE_RATIO_PREFERENCE, ratio));
	}, []);

	useLayoutResetEffect(() => {
		setFileTreePanelRatioState(getResizePreferenceDefaultValue(FILE_TREE_RATIO_PREFERENCE));
	});

	return {
		fileTreePanelRatio,
		setFileTreePanelRatio,
	};
}
