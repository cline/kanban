import { useMemo } from "react";

import { extractDiffEntries } from "@/kanban/chat/utils/session-artifacts";
import type { ChatTimelineEntry } from "@/kanban/chat/types";
import type { RuntimeWorkspaceFileChange } from "@/kanban/runtime/types";

function DiffLine({ prefix, text, tone }: { prefix: string; text: string; tone: string }): React.ReactElement {
	const lines = text.split("\n");
	return (
		<>
			{lines.map((line, index) => (
				<div key={`${prefix}-${index}`} className={`flex font-mono text-xs ${tone}`}>
					<span className="w-4 shrink-0 select-none">{prefix}</span>
					<span className="whitespace-pre-wrap break-words">{line}</span>
				</div>
			))}
		</>
	);
}

export function DiffViewerPanel({
	timeline,
	workspaceFiles,
	selectedPath,
	onSelectedPathChange,
}: {
	timeline: ChatTimelineEntry[];
	workspaceFiles: RuntimeWorkspaceFileChange[] | null;
	selectedPath: string | null;
	onSelectedPathChange: (path: string) => void;
}): React.ReactElement {
	const diffEntries = useMemo(() => {
		if (workspaceFiles && workspaceFiles.length > 0) {
			return workspaceFiles.map((file, index) => ({
				id: `workspace-${file.path}-${index}`,
				path: file.path,
				oldText: file.oldText,
				newText: file.newText ?? "",
				timestamp: 0,
				toolTitle: `${file.status} (${file.additions}+/${file.deletions}-)`,
			}));
		}
		return extractDiffEntries(timeline);
	}, [workspaceFiles, timeline]);
	const groupedByPath = useMemo(() => {
		const map = new Map<string, typeof diffEntries>();
		for (const entry of diffEntries) {
			const existing = map.get(entry.path);
			if (existing) {
				existing.push(entry);
			} else {
				map.set(entry.path, [entry]);
			}
		}
		return Array.from(map.entries()).sort(([pathA], [pathB]) => pathA.localeCompare(pathB));
	}, [diffEntries]);
	const visibleGroups = useMemo(() => {
		if (!selectedPath) {
			return groupedByPath;
		}
		const selectedGroup = groupedByPath.find(([path]) => path === selectedPath);
		return selectedGroup ? [selectedGroup] : groupedByPath;
	}, [groupedByPath, selectedPath]);

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-zinc-800">
			{groupedByPath.length === 0 ? (
				<div className="flex flex-1 items-center justify-center px-4 text-center">
					<p className="text-sm text-zinc-600">No diff yet. Move this task to In Progress to generate changes.</p>
				</div>
			) : (
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-3">
					{visibleGroups.map(([path, entries]) => (
						<section key={path} className="rounded-lg border border-zinc-800 bg-zinc-900/80">
							<div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
								<button
									type="button"
									onClick={() => onSelectedPathChange(path)}
									className="font-mono text-xs text-zinc-300 hover:text-zinc-100"
								>
									{path}
								</button>
								<span className="text-[11px] text-zinc-500">{entries.length} patch</span>
							</div>
							<div className="space-y-2 p-2">
								{entries.map((entry) => (
									<section key={entry.id} className="rounded border border-zinc-800 bg-zinc-950/80">
										<div className="flex items-center justify-between border-b border-zinc-800 px-2 py-1.5">
											<span className="text-[11px] text-zinc-400">{entry.toolTitle}</span>
											<span className="text-[11px] text-zinc-600">
												{entry.timestamp > 0 ? new Date(entry.timestamp).toLocaleTimeString() : "workspace"}
											</span>
										</div>
										<div className="space-y-1 p-2">
											{entry.oldText != null ? (
												<DiffLine prefix="-" text={entry.oldText} tone="text-red-300/80" />
											) : null}
											{entry.newText ? (
												<DiffLine prefix="+" text={entry.newText} tone="text-emerald-300/80" />
											) : null}
										</div>
									</section>
								))}
							</div>
						</section>
					))}
				</div>
			)}
		</div>
	);
}
