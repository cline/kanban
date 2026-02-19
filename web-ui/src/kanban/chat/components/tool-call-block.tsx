import {
	ArrowRightLeft,
	Brain,
	Check,
	ChevronRight,
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
import { useState } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
	pending: { Icon: Clock, className: "text-muted-foreground" },
	in_progress: { Icon: Loader2, className: "animate-spin text-amber-400" },
	completed: { Icon: Check, className: "text-green-400" },
	failed: { Icon: X, className: "text-red-400" },
} as const;

export function ToolCallBlock({ message }: { message: ChatToolCallMessage }): React.ReactElement {
	const { toolCall } = message;
	const [isOpen, setIsOpen] = useState(false);
	const KindIcon = toolKindIcons[toolCall.kind];
	const { Icon: StatusIcon, className: statusClass } = statusConfig[toolCall.status];

	return (
		<Collapsible
			open={isOpen}
			onOpenChange={setIsOpen}
			className="rounded-lg bg-card"
		>
			<CollapsibleTrigger asChild>
				<button
					type="button"
					className="flex w-full cursor-pointer items-center gap-1.5 px-2 py-1.5 text-left"
				>
					<ChevronRight className={`size-3 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
					<KindIcon className="size-3 shrink-0 text-muted-foreground" />
					<span className="min-w-0 flex-1 break-words text-xs text-foreground [overflow-wrap:anywhere]">
						{toolCall.title}
					</span>
					<StatusIcon className={`size-3 shrink-0 ${statusClass}`} />
				</button>
			</CollapsibleTrigger>

			<CollapsibleContent className="space-y-1 border-t border-border px-2 py-1.5">
				{toolCall.locations && toolCall.locations.length > 0 ? (
					<div className="space-y-0">
						{toolCall.locations.map((loc) => (
							<div key={`${loc.path}:${loc.line ?? 0}`} className="flex items-center gap-1">
								<MapPin className="size-2 shrink-0 text-muted-foreground/80" />
								<span className="min-w-0 break-all font-mono text-xs text-muted-foreground">
									{loc.path}
									{loc.line != null ? `:${loc.line}` : ""}
								</span>
							</div>
						))}
					</div>
				) : null}

				{toolCall.content && toolCall.content.length > 0 ? (
					<div className="space-y-0.5">
						{toolCall.content.map((item, i) => {
							if (item.type === "content") {
								return (
									<p key={i} className="whitespace-pre-wrap break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
										{item.content.text}
									</p>
								);
							}

							return (
								<div key={i} className="min-w-0 overflow-x-auto rounded bg-background px-1.5 py-1 font-mono text-xs">
									{item.oldText != null ? (
										<div className="whitespace-pre-wrap break-words text-red-400/70 [overflow-wrap:anywhere]">
											- {item.oldText}
										</div>
									) : null}
									<div className="whitespace-pre-wrap break-words text-green-400/70 [overflow-wrap:anywhere]">
										+ {item.newText}
									</div>
								</div>
							);
						})}
					</div>
				) : null}
			</CollapsibleContent>
		</Collapsible>
	);
}
