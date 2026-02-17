import type { ChatAgentMessage } from "@/kanban/chat/types";
import { renderMarkdown } from "@/kanban/chat/utils/render-markdown";

export function AgentMessage({ message }: { message: ChatAgentMessage }): React.ReactElement {
	return (
		<div className="max-w-[85%]">
			<div className="rounded-xl rounded-bl-sm border border-zinc-700/50 bg-zinc-800/60 px-3 py-2">
				<div className="text-sm text-zinc-200">
					{renderMarkdown(message.text)}
					{message.isStreaming ? (
						<span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-zinc-400" />
					) : null}
				</div>
			</div>
		</div>
	);
}
