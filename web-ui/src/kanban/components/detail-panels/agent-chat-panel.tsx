import { MessageSquare } from "lucide-react";

import { ChatInputArea } from "@/kanban/chat/components/chat-input-area";
import { ChatMessageList } from "@/kanban/chat/components/chat-message-list";
import { ChatStatusBar } from "@/kanban/chat/components/chat-status-bar";
import { useChatSession } from "@/kanban/chat/hooks/use-chat-session";

export function AgentChatPanel({ cardId }: { cardId: string }): React.ReactElement {
	// When ACP is wired up, cardId maps to a specific agent session.
	// The hook manages the session state, including mock simulation for now.
	const { session, sendPrompt, cancelPrompt, respondToPermission } = useChatSession(cardId);

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-zinc-800">
			{/* Header */}
			<div className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
				<MessageSquare className="size-3.5 text-zinc-500" />
				<span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
					Agent Chat
				</span>
			</div>

			{/* Message list */}
			<ChatMessageList
				timeline={session.timeline}
				onPermissionRespond={respondToPermission}
			/>

			{/* Status bar (shows when agent is busy) */}
			<ChatStatusBar status={session.status} />

			{/* Input area */}
			<ChatInputArea
				status={session.status}
				availableCommands={session.availableCommands}
				onSend={sendPrompt}
				onCancel={cancelPrompt}
			/>
		</div>
	);
}
