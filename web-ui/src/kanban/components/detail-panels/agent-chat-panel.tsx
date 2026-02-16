import { MessageSquare } from "lucide-react";

export function AgentChatPanel(): React.ReactElement {
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-zinc-800">
			<div className="flex h-10 items-center gap-2 border-b border-zinc-800 px-3">
				<MessageSquare className="size-3.5 text-zinc-500" />
				<span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
					Agent Chat
				</span>
			</div>
			<div className="flex flex-1 items-center justify-center">
				<p className="text-sm text-zinc-600">Agent communication will be connected via ACP</p>
			</div>
		</div>
	);
}
