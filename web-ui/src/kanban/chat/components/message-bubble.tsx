import type { ChatUserMessage } from "@/kanban/chat/types";

export function MessageBubble({ message }: { message: ChatUserMessage }): React.ReactElement {
	return (
		<div className="flex justify-end">
			<div className="max-w-[80%] rounded-xl rounded-br-sm border border-amber-500/20 bg-amber-500/15 px-3 py-2">
				<p className="whitespace-pre-wrap break-words text-sm text-zinc-100 [overflow-wrap:anywhere]">{message.text}</p>
			</div>
		</div>
	);
}
