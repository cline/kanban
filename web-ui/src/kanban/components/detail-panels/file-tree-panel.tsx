import { FolderTree } from "lucide-react";

export function FileTreePanel(): React.ReactElement {
	return (
		<div className="flex min-h-0 min-w-0 flex-[0.5] flex-col">
			<div className="flex h-10 items-center gap-2 border-b border-zinc-800 px-3">
				<FolderTree className="size-3.5 text-zinc-500" />
				<span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
					Files
				</span>
			</div>
			<div className="flex flex-1 items-center justify-center">
				<p className="text-sm text-zinc-600">File tree coming soon</p>
			</div>
		</div>
	);
}
