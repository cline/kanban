// Hook to periodically fetch and expose the active Cline account balance.
// Used by the top bar to show a small credit indicator.
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchClineAccountBalance } from "@/runtime/runtime-config-query";
import type { RuntimeClineAccountBalanceResponse } from "@/runtime/types";

const BALANCE_POLL_INTERVAL_MS = 60_000;

export function useClineAccountBalance(
	workspaceId: string | null,
	options?: { paused?: boolean },
): RuntimeClineAccountBalanceResponse | null {
	const [data, setData] = useState<RuntimeClineAccountBalanceResponse | null>(null);
	const generationRef = useRef(0);
	const paused = options?.paused ?? false;

	const refresh = useCallback(async () => {
		const generation = ++generationRef.current;
		try {
			const response = await fetchClineAccountBalance(workspaceId);
			if (generation === generationRef.current) {
				setData(response);
			}
		} catch {
			if (generation === generationRef.current) {
				setData(null);
			}
		}
	}, [workspaceId]);

	useEffect(() => {
		if (workspaceId === null || paused) {
			if (workspaceId === null) {
				setData(null);
			}
			return;
		}
		void refresh();
		const intervalId = window.setInterval(() => {
			void refresh();
		}, BALANCE_POLL_INTERVAL_MS);
		return () => {
			window.clearInterval(intervalId);
		};
	}, [workspaceId, paused, refresh]);

	return data;
}
