import { Ban, Loader2 } from "lucide-react";

import type { ChatSessionStatus } from "@/kanban/chat/types";

const statusDisplay: Record<
	Exclude<ChatSessionStatus, "idle">,
	{ Icon: React.ElementType; label: string; iconClass: string }
> = {
	thinking: { Icon: Loader2, label: "Agent is thinking...", iconClass: "animate-spin text-muted-foreground" },
	tool_running: { Icon: Loader2, label: "Running tool...", iconClass: "animate-spin text-amber-400" },
	cancelled: { Icon: Ban, label: "Cancelled", iconClass: "text-muted-foreground" },
};

export function ChatStatusBar({ status }: { status: ChatSessionStatus }): React.ReactElement | null {
	if (status === "idle") return null;

	const { Icon, label, iconClass } = statusDisplay[status];

	return (
		<div className="flex items-center gap-2 border-t border-border px-3 py-1.5">
			<Icon className={`size-3 ${iconClass}`} />
			<span className="text-xs text-muted-foreground">{label}</span>
		</div>
	);
}
