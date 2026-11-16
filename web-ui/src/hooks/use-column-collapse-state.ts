import { useCallback, useState } from "react";

import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";
import type { BoardColumnId } from "@/types/board";

const DEFAULT_STATE: Record<BoardColumnId, boolean> = {
	backlog: true,
	in_progress: true,
	review: true,
	trash: false,
};

function loadColumnCollapseState(projectId: string): Record<BoardColumnId, boolean> {
	const stored = readLocalStorageItem(LocalStorageKey.TaskDetailColumnsCollapsed);
	if (!stored) {
		return DEFAULT_STATE;
	}

	try {
		const parsed = JSON.parse(stored) as Record<string, Record<BoardColumnId, boolean>>;
		const projectState = parsed[projectId];
		if (!projectState) {
			return DEFAULT_STATE;
		}
		return { ...DEFAULT_STATE, ...projectState };
	} catch {
		return DEFAULT_STATE;
	}
}

function persistColumnCollapseState(projectId: string, state: Record<BoardColumnId, boolean>): void {
	const stored = readLocalStorageItem(LocalStorageKey.TaskDetailColumnsCollapsed);
	let parsed: Record<string, Record<BoardColumnId, boolean>> = {};

	if (stored) {
		try {
			parsed = JSON.parse(stored) as Record<string, Record<BoardColumnId, boolean>>;
		} catch {
			// Ignore parse errors
		}
	}

	parsed[projectId] = state;
	writeLocalStorageItem(LocalStorageKey.TaskDetailColumnsCollapsed, JSON.stringify(parsed));
}

export function useColumnCollapseState(projectId: string | null | undefined) {
	const [state, setState] = useState<Record<BoardColumnId, boolean>>(() => {
		if (!projectId) {
			return DEFAULT_STATE;
		}
		return loadColumnCollapseState(projectId);
	});

	const toggleColumn = useCallback(
		(columnId: BoardColumnId) => {
			if (!projectId) {
				return;
			}

			setState((prev) => {
				const newState = { ...prev, [columnId]: !prev[columnId] };
				persistColumnCollapseState(projectId, newState);
				return newState;
			});
		},
		[projectId],
	);

	const setColumnOpen = useCallback(
		(columnId: BoardColumnId, open: boolean) => {
			if (!projectId) {
				return;
			}

			setState((prev) => {
				if (prev[columnId] === open) {
					return prev;
				}
				const newState = { ...prev, [columnId]: open };
				persistColumnCollapseState(projectId, newState);
				return newState;
			});
		},
		[projectId],
	);

	return {
		collapseState: state,
		toggleColumn,
		setColumnOpen,
	};
}
