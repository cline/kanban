import { useEffect, useMemo, useRef, useState } from "react";

import type { ChatSessionState } from "@/kanban/chat/types";
import { extractReferencedPaths } from "@/kanban/chat/utils/session-artifacts";
import { AgentChatPanel } from "@/kanban/components/detail-panels/agent-chat-panel";
import { ColumnContextPanel } from "@/kanban/components/detail-panels/column-context-panel";
import { DiffViewerPanel } from "@/kanban/components/detail-panels/diff-viewer-panel";
import { FileTreePanel } from "@/kanban/components/detail-panels/file-tree-panel";
import { useRuntimeWorkspaceChanges } from "@/kanban/runtime/use-runtime-workspace-changes";
import type { CardSelection } from "@/kanban/types";

export function CardDetailView({
	selection,
	session,
	onBack,
	onCardSelect,
	onSendPrompt,
	onCancelPrompt,
	onPermissionRespond,
	onMoveToTrash,
	sendDisabled,
	sendDisabledReason,
}: {
	selection: CardSelection;
	session: ChatSessionState;
	onBack: () => void;
	onCardSelect: (taskId: string) => void;
	onSendPrompt: (text: string) => void;
	onCancelPrompt: () => void;
	onPermissionRespond: (messageId: string, optionId: string) => void;
	onMoveToTrash: () => void;
	sendDisabled?: boolean;
	sendDisabledReason?: string;
}): React.ReactElement {
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const { changes: workspaceChanges, isRuntimeAvailable, refresh } = useRuntimeWorkspaceChanges(
		selection.card.id,
		selection.card.baseRef ?? null,
	);
	const previousStatusRef = useRef(session.status);
	const runtimeFiles = workspaceChanges?.files ?? null;
	const availablePaths = useMemo(() => {
		if (runtimeFiles && runtimeFiles.length > 0) {
			return runtimeFiles.map((file) => file.path);
		}
		return extractReferencedPaths(session.timeline);
	}, [runtimeFiles, session.timeline]);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null;
			const isTypingTarget =
				target?.tagName === "INPUT" ||
				target?.tagName === "TEXTAREA" ||
				target?.isContentEditable;
			if (isTypingTarget) {
				return;
			}

			if (event.key === "Escape") {
				onBack();
				return;
			}

			const cards = selection.column.cards;
			const currentIndex = cards.findIndex((card) => card.id === selection.card.id);
			if (currentIndex === -1) {
				return;
			}

			if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
				event.preventDefault();
				const previousIndex = (currentIndex - 1 + cards.length) % cards.length;
				const previousCard = cards[previousIndex];
				if (previousCard) {
					onCardSelect(previousCard.id);
				}
				return;
			}

			if (event.key === "ArrowDown" || event.key === "ArrowRight") {
				event.preventDefault();
				const nextIndex = (currentIndex + 1) % cards.length;
				const nextCard = cards[nextIndex];
				if (nextCard) {
					onCardSelect(nextCard.id);
				}
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onBack, onCardSelect, selection.card.id, selection.column.cards]);

	useEffect(() => {
		if (selectedPath && availablePaths.includes(selectedPath)) {
			return;
		}
		setSelectedPath(availablePaths[0] ?? null);
	}, [availablePaths, selectedPath]);

	useEffect(() => {
		const previousStatus = previousStatusRef.current;
		previousStatusRef.current = session.status;
		if (previousStatus !== "idle" && session.status === "idle") {
			void refresh();
		}
	}, [refresh, session.status]);

	return (
		<div className="flex min-h-0 flex-1 overflow-hidden bg-background">
			<ColumnContextPanel selection={selection} onCardSelect={onCardSelect} />
			<div className="flex h-full min-h-0 w-4/5 min-w-0 flex-col overflow-hidden bg-background">
				<div className="flex min-h-0 flex-1 overflow-hidden">
					<AgentChatPanel
						session={session}
						onSend={onSendPrompt}
						onCancel={onCancelPrompt}
						onPermissionRespond={onPermissionRespond}
						showMoveToTrash={selection.column.id === "review"}
						onMoveToTrash={onMoveToTrash}
						sendDisabled={sendDisabled}
						sendDisabledReason={sendDisabledReason}
					/>
					<DiffViewerPanel
						timeline={session.timeline}
						workspaceFiles={isRuntimeAvailable ? runtimeFiles : null}
						selectedPath={selectedPath}
						onSelectedPathChange={setSelectedPath}
					/>
					<FileTreePanel
						timeline={session.timeline}
						workspaceFiles={isRuntimeAvailable ? runtimeFiles : null}
						selectedPath={selectedPath}
						onSelectPath={setSelectedPath}
					/>
				</div>
			</div>
		</div>
	);
}
