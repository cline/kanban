import { useCallback, useEffect, useState } from "react";

import type { RuntimeTaskSessionListResponse, RuntimeTaskSessionSummary } from "@/kanban/runtime/types";

interface RuntimeErrorPayload {
	error?: string;
}

const POLL_INTERVAL_MS = 1200;

export interface UseRuntimeTaskSessionsResult {
	sessions: Record<string, RuntimeTaskSessionSummary>;
	refresh: () => Promise<void>;
}

export function useRuntimeTaskSessions(): UseRuntimeTaskSessionsResult {
	const [sessions, setSessions] = useState<Record<string, RuntimeTaskSessionSummary>>({});

	const refresh = useCallback(async () => {
		try {
			const response = await fetch("/api/runtime/task-sessions");
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as RuntimeErrorPayload | null;
				throw new Error(payload?.error ?? `Task sessions request failed with ${response.status}`);
			}
			const payload = (await response.json()) as RuntimeTaskSessionListResponse;
			const next: Record<string, RuntimeTaskSessionSummary> = {};
			for (const summary of payload.sessions) {
				next[summary.taskId] = summary;
			}
			setSessions(next);
		} catch {
			setSessions((current) => current);
		}
	}, []);

	useEffect(() => {
		void refresh();
		const intervalId = window.setInterval(() => {
			void refresh();
		}, POLL_INTERVAL_MS);
		return () => {
			window.clearInterval(intervalId);
		};
	}, [refresh]);

	return {
		sessions,
		refresh,
	};
}
