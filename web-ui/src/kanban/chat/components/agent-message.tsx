import type { ChatAgentMessage } from "@/kanban/chat/types";
import { renderMarkdown } from "@/kanban/chat/utils/render-markdown";

export function AgentMessage({ message }: { message: ChatAgentMessage }): React.ReactElement {
	return (
		<div className="min-w-0 max-w-[85%]">
			<div className="min-w-0 break-words text-sm text-foreground [overflow-wrap:anywhere]">{renderMarkdown(message.text)}</div>
		</div>
	);
}
