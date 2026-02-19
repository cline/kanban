import type { ChatSessionStatus, ChatTimelineEntry } from "@/kanban/chat/types";

export interface AcpTurnRequest {
	taskId: string;
	taskTitle: string;
	taskDescription: string;
	prompt: string;
	baseRef?: string | null;
}

export interface AcpTurnCallbacks {
	onEntry: (entry: ChatTimelineEntry) => void;
	onStatus: (status: ChatSessionStatus) => void;
	onComplete: () => void;
	onAvailableCommands?: (commands: Array<{ name: string; description: string; input?: { hint?: string } }>) => void;
	onError?: (message: string) => void;
}

export interface AcpTurnController {
	cancel: () => void;
	done: Promise<void>;
}

export interface AcpClient {
	runTurn(request: AcpTurnRequest, callbacks: AcpTurnCallbacks): AcpTurnController;
}
