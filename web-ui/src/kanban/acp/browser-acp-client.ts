import { MockAcpClient } from "@/kanban/acp/mock-acp-client";
import type { AcpClient, AcpTurnCallbacks, AcpTurnController, AcpTurnRequest } from "@/kanban/acp/types";
import type { ChatTimelineEntry } from "@/kanban/chat/types";

interface RuntimeTurnResponse {
	entries: ChatTimelineEntry[];
	stopReason: string;
	availableCommands?: Array<{ name: string; description: string; input?: { hint?: string } }>;
}

interface RuntimeTurnError {
	error: string;
}

export class BrowserAcpClient implements AcpClient {
	private readonly fallback = new MockAcpClient();

	runTurn(request: AcpTurnRequest, callbacks: AcpTurnCallbacks): AcpTurnController {
		const abortController = new AbortController();
		let activeFallback: AcpTurnController | null = null;

		const done = (async () => {
			callbacks.onStatus("thinking");
			try {
				const response = await fetch("/api/acp/turn", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify(request),
					signal: abortController.signal,
				});

				if (!response.ok) {
					const errorBody = (await response.json().catch(() => null)) as RuntimeTurnError | null;
					throw new Error(errorBody?.error ?? `Runtime ACP request failed with ${response.status}`);
				}

				const payload = (await response.json()) as RuntimeTurnResponse;
				for (const entry of payload.entries) {
					callbacks.onEntry(entry);
				}
				if (payload.availableCommands && callbacks.onAvailableCommands) {
					callbacks.onAvailableCommands(payload.availableCommands);
				}
				callbacks.onStatus("idle");
				callbacks.onComplete();
			} catch {
				if (abortController.signal.aborted) {
					callbacks.onStatus("cancelled");
					return;
				}
				activeFallback = this.fallback.runTurn(request, callbacks);
				await activeFallback.done;
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
				if (activeFallback) {
					activeFallback.cancel();
				}
			},
			done,
		};
	}
}
