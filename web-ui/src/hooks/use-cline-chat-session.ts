// Manages the message list and send or cancel lifecycle for one native Cline session.
// It merges loaded history with streamed updates and guards against stale task
// switches so chat surfaces can stay reactive without duplicating logic.
import { useCallback, useEffect, useState } from "react";
import type { ClineChatActionResult } from "@/hooks/use-cline-chat-runtime-actions";
import type { RuntimeTaskChatMessage, RuntimeTaskImage, RuntimeTaskSessionMode } from "@/runtime/types";

export type ClineChatMessage = RuntimeTaskChatMessage;

interface UseClineChatSessionInput {
	taskId: string;
	onSendMessage?: (
		taskId: string,
		text: string,
		options?: { mode?: RuntimeTaskSessionMode; images?: RuntimeTaskImage[] },
	) => Promise<ClineChatActionResult>;
	onCancelTurn?: (taskId: string) => Promise<{ ok: boolean; message?: string }>;
	onLoadMessages?: (taskId: string) => Promise<ClineChatMessage[] | null>;
	incomingMessages?: ClineChatMessage[] | null;
	incomingMessage?: ClineChatMessage | null;
}

interface UseClineChatSessionResult {
	messages: ClineChatMessage[];
	isSending: boolean;
	isCanceling: boolean;
	error: string | null;
	sendMessage: (
		text: string,
		options?: { mode?: RuntimeTaskSessionMode; images?: RuntimeTaskImage[] },
	) => Promise<boolean>;
	cancelTurn: () => Promise<boolean>;
}

function areMessagesEqual(left: ClineChatMessage, right: ClineChatMessage): boolean {
	return (
		left.content === right.content &&
		left.role === right.role &&
		left.createdAt === right.createdAt &&
		JSON.stringify(left.meta ?? null) === JSON.stringify(right.meta ?? null)
	);
}

function upsertMessage(currentMessages: ClineChatMessage[], nextMessage: ClineChatMessage): ClineChatMessage[] {
	const existingIndex = currentMessages.findIndex((message) => message.id === nextMessage.id);
	if (existingIndex < 0) {
		return [...currentMessages, nextMessage];
	}
	const existingMessage = currentMessages[existingIndex];
	if (!existingMessage || areMessagesEqual(existingMessage, nextMessage)) {
		return currentMessages;
	}
	const nextMessages = [...currentMessages];
	nextMessages[existingIndex] = nextMessage;
	return nextMessages;
}

function mergeMessages(baseMessages: ClineChatMessage[], additionalMessages: ClineChatMessage[]): ClineChatMessage[] {
	return additionalMessages.reduce((nextMessages, message) => upsertMessage(nextMessages, message), [...baseMessages]);
}

export function useClineChatSession({
	taskId,
	onSendMessage,
	onCancelTurn,
	onLoadMessages,
	incomingMessages = null,
	incomingMessage = null,
}: UseClineChatSessionInput): UseClineChatSessionResult {
	const [messages, setMessages] = useState<ClineChatMessage[]>([]);
	const [isSending, setIsSending] = useState(false);
	const [isCanceling, setIsCanceling] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setMessages([]);
		setError(null);
	}, [taskId]);

	useEffect(() => {
		if (!onLoadMessages) {
			setMessages([]);
			return;
		}
		setError(null);
		let cancelled = false;
		setIsLoading(true);
		void onLoadMessages(taskId)
			.then((loadedMessages) => {
				if (cancelled) {
					return;
				}
				setMessages((currentMessages) => mergeMessages(loadedMessages ?? [], currentMessages));
			})
			.catch((loadError) => {
				if (cancelled) {
					return;
				}
				const message = loadError instanceof Error ? loadError.message : String(loadError);
				setError(message);
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [onLoadMessages, taskId]);

	useEffect(() => {
		if (incomingMessages === null) {
			return;
		}
		if (incomingMessages.length === 0) {
			setMessages([]);
			return;
		}
		setMessages((currentMessages) => mergeMessages(currentMessages, incomingMessages));
	}, [incomingMessages]);

	useEffect(() => {
		if (!incomingMessage) {
			return;
		}
		setMessages((currentMessages) => upsertMessage(currentMessages, incomingMessage));
	}, [incomingMessage]);

	const cancelTurn = useCallback(async (): Promise<boolean> => {
		if (!onCancelTurn || isCanceling) {
			return false;
		}
		setError(null);
		setIsCanceling(true);
		try {
			const result = await onCancelTurn(taskId);
			if (!result.ok) {
				setError(result.message ?? "Could not cancel turn.");
				return false;
			}
			return true;
		} catch (cancelError) {
			const message = cancelError instanceof Error ? cancelError.message : String(cancelError);
			setError(message);
			return false;
		} finally {
			setIsCanceling(false);
		}
	}, [isCanceling, onCancelTurn, taskId]);

	const sendMessage = useCallback(
		async (
			text: string,
			options?: { mode?: RuntimeTaskSessionMode; images?: RuntimeTaskImage[] },
		): Promise<boolean> => {
			const trimmed = text.trim();
			const hasImages = Boolean(options?.images && options.images.length > 0);
			if ((!trimmed && !hasImages) || !onSendMessage) {
				return false;
			}

			setError(null);
			setIsSending(true);

			try {
				const result = options
					? await onSendMessage(taskId, trimmed, options)
					: await onSendMessage(taskId, trimmed);
				if (!result.ok) {
					const message = result.message ?? "Could not send message.";
					setError(message);
					return false;
				}
				const sentMessage = result.chatMessage ?? null;
				if (sentMessage) {
					setMessages((currentMessages) => upsertMessage(currentMessages, sentMessage));
				} else if (onLoadMessages) {
					const loadedMessages = await onLoadMessages(taskId);
					setMessages(loadedMessages ?? []);
				}
				return true;
			} catch (sendError) {
				const message = sendError instanceof Error ? sendError.message : String(sendError);
				setError(message);
				return false;
			} finally {
				setIsSending(false);
			}
		},
		[onLoadMessages, onSendMessage, taskId],
	);

	return {
		messages,
		isSending: isSending || isLoading,
		isCanceling,
		error,
		sendMessage,
		cancelTurn,
	};
}
