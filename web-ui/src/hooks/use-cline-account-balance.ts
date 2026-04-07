// Hook to periodically fetch and expose the active Cline account balance.
// Used by the top bar to show a small credit indicator.
import { useCallback, useEffect, useState } from "react";
import { fetchClineAccountBalance } from "@/runtime/runtime-config-query";
import type { RuntimeClineAccountBalanceResponse } from "@/runtime/types";

const BALANCE_POLL_INTERVAL_MS = 60_000;

export function useClineAccountBalance(workspaceId: string | null): RuntimeClineAccountBalanceResponse | null {
	const [data, setData] = useState<RuntimeClineAccountBalanceResponse | null>(null);

	const refresh = useCallback(async () => {
		try {
			const response = await fetchClineAccountBalance(workspaceId);
			setData(response);
		} catch {
			// Silently fail – the indicator simply won't render.
		}
	}, [workspaceId]);

	useEffect(() => {
		void refresh();
		const intervalId = window.setInterval(() => {
			void refresh();
		}, BALANCE_POLL_INTERVAL_MS);
		return () => {
			window.clearInterval(intervalId);
		};
	}, [refresh]);

	return data;
}
