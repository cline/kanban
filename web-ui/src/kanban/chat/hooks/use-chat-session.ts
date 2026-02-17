import { useCallback, useEffect, useReducer, useRef } from "react";

import { createMockSession, simulateAgentResponse } from "@/kanban/chat/data/mock-session";
import type {
	ChatSessionState,
	ChatSessionStatus,
	ChatTimelineEntry,
} from "@/kanban/chat/types";

// ---- Reducer Actions ----

type ChatAction =
	| { type: "ADD_ENTRY"; entry: ChatTimelineEntry }
	| { type: "UPDATE_ENTRY"; entry: ChatTimelineEntry }
	| { type: "SET_STATUS"; status: ChatSessionStatus }
	| { type: "RESOLVE_PERMISSION"; messageId: string; optionId: string }
	| { type: "RESET"; state: ChatSessionState };

function chatReducer(state: ChatSessionState, action: ChatAction): ChatSessionState {
	switch (action.type) {
		case "ADD_ENTRY":
			return { ...state, timeline: [...state.timeline, action.entry] };

		case "UPDATE_ENTRY": {
			// Replace entry with matching id, or append if not found
			const idx = state.timeline.findIndex((e) => e.id === action.entry.id);
			if (idx === -1) {
				return { ...state, timeline: [...state.timeline, action.entry] };
			}
			const updated = [...state.timeline];
			updated[idx] = action.entry;
			return { ...state, timeline: updated };
		}

		case "SET_STATUS":
			return { ...state, status: action.status };

		case "RESOLVE_PERMISSION": {
			return {
				...state,
				timeline: state.timeline.map((entry) => {
					if (entry.type === "permission_request" && entry.id === action.messageId) {
						return { ...entry, resolved: true, selectedOptionId: action.optionId };
					}
					return entry;
				}),
			};
		}

		case "RESET":
			return action.state;

		default:
			return state;
	}
}

// ---- Hook ----

export interface UseChatSessionReturn {
	session: ChatSessionState;
	sendPrompt: (text: string) => void;
	cancelPrompt: () => void;
	respondToPermission: (messageId: string, optionId: string) => void;
}

export function useChatSession(_cardId: string): UseChatSessionReturn {
	// When ACP is wired up, cardId will map to a specific agent session.
	// For now, all cards share the same mock session.
	const [session, dispatch] = useReducer(chatReducer, null, createMockSession);
	const cancelRef = useRef<(() => void) | null>(null);

	// Clean up simulation on unmount
	useEffect(() => {
		return () => {
			cancelRef.current?.();
		};
	}, []);

	const sendPrompt = useCallback(
		(text: string) => {
			if (session.status !== "idle") return;

			// Add user message to timeline
			const userMsg: ChatTimelineEntry = {
				type: "user_message",
				id: `user-${Date.now()}`,
				timestamp: Date.now(),
				text,
			};
			dispatch({ type: "ADD_ENTRY", entry: userMsg });

			// Start mock simulation
			// When ACP is wired up, replace this with:
			//   connection.prompt({ sessionId, prompt: [{ type: "text", text }] })
			// and handle session updates via the sessionUpdate callback.
			cancelRef.current?.();
			cancelRef.current = simulateAgentResponse(
				text,
				(entry) => dispatch({ type: "UPDATE_ENTRY", entry }),
				(status) => dispatch({ type: "SET_STATUS", status }),
			);
		},
		[session.status],
	);

	const cancelPrompt = useCallback(() => {
		// When ACP is wired up, call: connection.cancel({ sessionId })
		cancelRef.current?.();
		cancelRef.current = null;
		dispatch({ type: "SET_STATUS", status: "cancelled" });

		// Reset to idle after a beat
		setTimeout(() => {
			dispatch({ type: "SET_STATUS", status: "idle" });
		}, 1500);
	}, []);

	const respondToPermission = useCallback((messageId: string, optionId: string) => {
		// When ACP is wired up, this sends the permission response back:
		//   return { outcome: { outcome: "selected", optionId } }
		dispatch({ type: "RESOLVE_PERMISSION", messageId, optionId });
	}, []);

	return { session, sendPrompt, cancelPrompt, respondToPermission };
}
