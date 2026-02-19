import type { AcpClient, AcpTurnCallbacks, AcpTurnController, AcpTurnRequest } from "@/kanban/acp/types";
import type { ChatSessionStatus, ChatTimelineEntry } from "@/kanban/chat/types";

interface RuntimeTurnError {
	error: string;
}

interface RuntimeTurnStreamEntryEvent {
	type: "entry";
	entry: ChatTimelineEntry;
}

interface RuntimeTurnStreamStatusEvent {
	type: "status";
	status: Exclude<ChatSessionStatus, "cancelled">;
}

interface RuntimeTurnStreamCommandsEvent {
	type: "available_commands";
	commands: Array<{ name: string; description: string; input?: { hint?: string } }>;
}

interface RuntimeTurnStreamCompleteEvent {
	type: "complete";
	stopReason: string;
}

interface RuntimeTurnStreamErrorEvent {
	type: "error";
	error: string;
}

type RuntimeTurnStreamEvent =
	| RuntimeTurnStreamEntryEvent
	| RuntimeTurnStreamStatusEvent
	| RuntimeTurnStreamCommandsEvent
	| RuntimeTurnStreamCompleteEvent
	| RuntimeTurnStreamErrorEvent;

class RuntimeTurnFailure extends Error {
	constructor(
		message: string,
		public readonly statusCode?: number,
	) {
		super(message);
	}
}

function parseStreamEvent(raw: string): RuntimeTurnStreamEvent {
	return JSON.parse(raw) as RuntimeTurnStreamEvent;
}

async function processTurnStream(
	response: Response,
	callbacks: AcpTurnCallbacks,
	signal: AbortSignal,
): Promise<void> {
	if (!response.body) {
		throw new Error("Runtime ACP stream did not include a response body.");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let completed = false;

	const handleEvent = (event: RuntimeTurnStreamEvent): boolean => {
		switch (event.type) {
			case "entry":
				callbacks.onEntry(event.entry);
				return false;
			case "status":
				callbacks.onStatus(event.status);
				return false;
			case "available_commands":
				callbacks.onAvailableCommands?.(event.commands);
				return false;
			case "complete":
				completed = true;
				callbacks.onStatus("idle");
				callbacks.onComplete();
				return true;
			case "error":
				throw new Error(event.error);
		}
	};

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		buffer += decoder.decode(value, { stream: true });

		while (true) {
			const newlineIndex = buffer.indexOf("\n");
			if (newlineIndex === -1) {
				break;
			}
			const line = buffer.slice(0, newlineIndex).trim();
			buffer = buffer.slice(newlineIndex + 1);
			if (!line) {
				continue;
			}
			const event = parseStreamEvent(line);
			if (handleEvent(event)) {
				await reader.cancel();
				return;
			}
		}
	}

	buffer += decoder.decode();
	while (true) {
		const newlineIndex = buffer.indexOf("\n");
		if (newlineIndex === -1) {
			break;
		}
		const line = buffer.slice(0, newlineIndex).trim();
		buffer = buffer.slice(newlineIndex + 1);
		if (!line) {
			continue;
		}
		const event = parseStreamEvent(line);
		if (handleEvent(event)) {
			await reader.cancel();
			return;
		}
	}

	const trailingLine = buffer.trim();
	if (trailingLine) {
		const event = parseStreamEvent(trailingLine);
		handleEvent(event);
	}

	if (!completed && !signal.aborted) {
		throw new Error("Runtime ACP stream ended unexpectedly.");
	}
}

export class BrowserAcpClient implements AcpClient {
	runTurn(request: AcpTurnRequest, callbacks: AcpTurnCallbacks): AcpTurnController {
		const abortController = new AbortController();

		const done = (async () => {
			callbacks.onStatus("thinking");
			try {
				const response = await fetch("/api/acp/turn?stream=1", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify(request),
					signal: abortController.signal,
				});

				if (!response.ok) {
					const errorBody = (await response.json().catch(() => null)) as RuntimeTurnError | null;
					throw new RuntimeTurnFailure(
						errorBody?.error ?? `Runtime ACP request failed with ${response.status}`,
						response.status,
					);
				}

				await processTurnStream(response, callbacks, abortController.signal);
			} catch (error) {
				if (abortController.signal.aborted) {
					callbacks.onStatus("cancelled");
					return;
				}

				let message = error instanceof Error ? error.message : String(error);
				if (error instanceof RuntimeTurnFailure && error.statusCode === 501) {
					message = "ACP command is not configured. Open Settings and pick an installed ACP agent command.";
				} else if (error instanceof TypeError) {
					message = "Cannot reach Kanbanana runtime. Start the local Kanbanana server and try again.";
				}

				callbacks.onEntry({
					type: "agent_message",
					id: `runtime-error-${Date.now()}`,
					timestamp: Date.now(),
					text: `Runtime ACP error: ${message}`,
					isStreaming: false,
				});
				callbacks.onStatus("idle");
				callbacks.onError?.(message);
			}
		})();

		return {
			cancel: () => {
				void fetch("/api/acp/cancel", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						taskId: request.taskId,
					}),
				}).catch(() => undefined);
				abortController.abort();
			},
			done,
		};
	}
}
