import { ChatInputArea } from "@/kanban/chat/components/chat-input-area";
import { ChatMessageList } from "@/kanban/chat/components/chat-message-list";
import { ChatStatusBar } from "@/kanban/chat/components/chat-status-bar";
import type { ChatSessionState } from "@/kanban/chat/types";

export function AgentChatPanel({
	session,
	onSend,
	onCancel,
	onPermissionRespond,
	sendDisabled,
	sendDisabledReason,
}: {
	session: ChatSessionState;
	onSend: (text: string) => void;
	onCancel: () => void;
	onPermissionRespond: (messageId: string, optionId: string) => void;
	sendDisabled?: boolean;
	sendDisabledReason?: string;
}): React.ReactElement {
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-border bg-background">
			<ChatMessageList
				timeline={session.timeline}
				onPermissionRespond={onPermissionRespond}
			/>

			<ChatStatusBar status={session.status} />

			<ChatInputArea
				status={session.status}
				availableCommands={session.availableCommands}
				onSend={onSend}
				onCancel={onCancel}
				disabled={sendDisabled}
				disabledReason={sendDisabledReason}
			/>
		</div>
	);
}
