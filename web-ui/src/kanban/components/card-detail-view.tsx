import { useEffect, useMemo, useState } from "react";

import type { ChatSessionState } from "@/kanban/chat/types";
import { extractReferencedPaths } from "@/kanban/chat/utils/session-artifacts";
import { AgentChatPanel } from "@/kanban/components/detail-panels/agent-chat-panel";
import { ColumnContextPanel } from "@/kanban/components/detail-panels/column-context-panel";
import { DiffViewerPanel } from "@/kanban/components/detail-panels/diff-viewer-panel";
import { FileTreePanel } from "@/kanban/components/detail-panels/file-tree-panel";
import type { CardSelection } from "@/kanban/types";

export function CardDetailView({
	selection,
	session,
	onBack,
	onCardSelect,
	onSendPrompt,
	onCancelPrompt,
	onPermissionRespond,
}: {
	selection: CardSelection;
	session: ChatSessionState;
	onBack: () => void;
	onCardSelect: (taskId: string) => void;
	onSendPrompt: (text: string) => void;
	onCancelPrompt: () => void;
	onPermissionRespond: (messageId: string, optionId: string) => void;
}): React.ReactElement {
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const availablePaths = useMemo(() => extractReferencedPaths(session.timeline), [session.timeline]);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				onBack();
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onBack]);

	useEffect(() => {
		if (selectedPath && availablePaths.includes(selectedPath)) {
			return;
		}
		setSelectedPath(availablePaths[0] ?? null);
	}, [availablePaths, selectedPath]);

	return (
		<div className="flex min-h-0 flex-1 overflow-hidden bg-zinc-900">
			<ColumnContextPanel selection={selection} onCardSelect={onCardSelect} />
			<div className="flex h-full min-h-0 w-4/5 min-w-0 overflow-hidden bg-zinc-900">
				<AgentChatPanel
					session={session}
					onSend={onSendPrompt}
					onCancel={onCancelPrompt}
					onPermissionRespond={onPermissionRespond}
				/>
				<DiffViewerPanel
					timeline={session.timeline}
					selectedPath={selectedPath}
					onSelectedPathChange={setSelectedPath}
				/>
				<FileTreePanel timeline={session.timeline} selectedPath={selectedPath} onSelectPath={setSelectedPath} />
			</div>
		</div>
	);
}
