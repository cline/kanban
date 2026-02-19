import type { ChatAgentMessage } from "@/kanban/chat/types";
import { renderMarkdown } from "@/kanban/chat/utils/render-markdown";

export function AgentMessage({ message }: { message: ChatAgentMessage }): React.ReactElement {
	return (
		<div className="min-w-0 max-w-[85%]">
			<div className="rounded-xl rounded-bl-sm border border-zinc-700/50 bg-zinc-800/60 px-3 py-2">
				<div className="min-w-0 break-words text-sm text-zinc-200 [overflow-wrap:anywhere]">{renderMarkdown(message.text)}</div>
			</div>
		</div>
	);
}
