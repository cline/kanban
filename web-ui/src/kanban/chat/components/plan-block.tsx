import { CheckCircle2, Circle, Loader2 } from "lucide-react";

import type { ChatPlanEntry, ChatPlanMessage } from "@/kanban/chat/types";

const statusIcons = {
	completed: { Icon: CheckCircle2, className: "text-green-400" },
	in_progress: { Icon: Loader2, className: "animate-spin text-amber-400" },
	pending: { Icon: Circle, className: "text-zinc-600" },
} as const;

const priorityColors = {
	high: "text-red-400/70",
	medium: "text-amber-400/70",
	low: "text-zinc-500",
} as const;

function PlanEntryRow({ entry }: { entry: ChatPlanEntry }): React.ReactElement {
	const { Icon, className: iconClass } = statusIcons[entry.status];
	const textClass = entry.status === "pending" ? "text-zinc-500" : "text-zinc-300";

	return (
		<div className="flex items-center gap-2 py-0.5">
			<Icon className={`size-3.5 shrink-0 ${iconClass}`} />
			<span className={`min-w-0 flex-1 text-sm ${textClass}`}>{entry.content}</span>
			<span className={`shrink-0 text-xs ${priorityColors[entry.priority]}`}>
				{entry.priority}
			</span>
		</div>
	);
}

export function PlanBlock({ message }: { message: ChatPlanMessage }): React.ReactElement {
	return (
		<div className="rounded-lg border border-zinc-700/50 bg-zinc-800/40 p-3">
			<p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Plan</p>
			<div className="space-y-0.5">
				{message.entries.map((entry, i) => (
					<PlanEntryRow key={i} entry={entry} />
				))}
			</div>
		</div>
	);
}
