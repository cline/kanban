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

const FILE_TREE_RATIO_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.GitDiffFileTreePanelRatio,
	defaultValue: 0.375,
	normalize: (value) => clampBetween(value, 0.12, 0.6),
};

const FILE_TREE_VISIBLE_PREFERENCE: ResizeBooleanPreference = {
	key: LocalStorageKey.GitDiffFileTreeVisible,
	defaultValue: true,
};

export function useGitCommitDiffLayout(): {
	fileTreePanelRatio: number;
	isFileTreeVisible: boolean;
	setFileTreePanelRatio: (ratio: number) => void;
	setFileTreeVisible: (visible: boolean) => void;
} {
	const [fileTreePanelRatio, setFileTreePanelRatioState] = useState(() =>
		loadResizePreference(FILE_TREE_RATIO_PREFERENCE),
	);
	const [isFileTreeVisible, setIsFileTreeVisibleState] = useState(() =>
		loadBooleanResizePreference(FILE_TREE_VISIBLE_PREFERENCE),
	);

	const setFileTreePanelRatio = useCallback((ratio: number) => {
		setFileTreePanelRatioState(persistResizePreference(FILE_TREE_RATIO_PREFERENCE, ratio));
	}, []);

	const setFileTreeVisible = useCallback((visible: boolean) => {
		setIsFileTreeVisibleState(persistBooleanResizePreference(FILE_TREE_VISIBLE_PREFERENCE, visible));
	}, []);

	useLayoutResetEffect(() => {
		setFileTreePanelRatioState(getResizePreferenceDefaultValue(FILE_TREE_RATIO_PREFERENCE));
		setIsFileTreeVisibleState(FILE_TREE_VISIBLE_PREFERENCE.defaultValue);
	});

	return {
		fileTreePanelRatio,
		setFileTreePanelRatio,
		isFileTreeVisible,
		setFileTreeVisible,
	};
}
