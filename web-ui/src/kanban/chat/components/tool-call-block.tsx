import {
	ArrowRightLeft,
	Brain,
	Check,
	Clock,
	FilePen,
	FileSearch,
	FolderInput,
	Globe,
	Loader2,
	MapPin,
	Search,
	Terminal,
	Trash2,
	Wrench,
	X,
} from "lucide-react";

import type { ChatToolCallMessage, ChatToolKind } from "@/kanban/chat/types";

const toolKindIcons: Record<ChatToolKind, React.ElementType> = {
	read: FileSearch,
	edit: FilePen,
	delete: Trash2,
	move: FolderInput,
	search: Search,
	execute: Terminal,
	think: Brain,
	fetch: Globe,
	switch_mode: ArrowRightLeft,
	other: Wrench,
};

const statusConfig = {
	pending: { Icon: Clock, className: "text-zinc-500" },
	in_progress: { Icon: Loader2, className: "animate-spin text-amber-400" },
	completed: { Icon: Check, className: "text-green-400" },
	failed: { Icon: X, className: "text-red-400" },
} as const;

export function ToolCallBlock({ message }: { message: ChatToolCallMessage }): React.ReactElement {
	const { toolCall } = message;
	const KindIcon = toolKindIcons[toolCall.kind];
	const { Icon: StatusIcon, className: statusClass } = statusConfig[toolCall.status];

	return (
		<div className="rounded-lg border border-zinc-700/50 bg-zinc-800/40 p-2.5">
			{/* Header: kind icon + title + status */}
			<div className="flex items-center gap-2">
				<KindIcon className="size-3.5 shrink-0 text-zinc-400" />
				<span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{toolCall.title}</span>
				<StatusIcon className={`size-3.5 shrink-0 ${statusClass}`} />
			</div>

			{/* File locations */}
			{toolCall.locations && toolCall.locations.length > 0 ? (
				<div className="mt-1.5 space-y-0.5">
					{toolCall.locations.map((loc) => (
						<div key={`${loc.path}:${loc.line ?? 0}`} className="flex items-center gap-1.5">
							<MapPin className="size-2.5 shrink-0 text-zinc-600" />
							<span className="truncate font-mono text-xs text-zinc-500">
								{loc.path}
								{loc.line != null ? `:${loc.line}` : ""}
							</span>
						</div>
					))}
				</div>
			) : null}

			{/* Content */}
			{toolCall.content && toolCall.content.length > 0 ? (
				<div className="mt-1.5 space-y-1">
					{toolCall.content.map((item, i) => {
						if (item.type === "content") {
							return (
								<p key={i} className="text-xs text-zinc-400">
									{item.content.text}
								</p>
							);
						}
						// Diff content
						return (
							<div key={i} className="overflow-x-auto rounded bg-zinc-900 p-2 font-mono text-xs">
								{item.oldText != null ? (
									<div className="text-red-400/70">- {item.oldText}</div>
								) : null}
								<div className="text-green-400/70">+ {item.newText}</div>
							</div>
						);
					})}
				</div>
			) : null}
		</div>
	);
}
