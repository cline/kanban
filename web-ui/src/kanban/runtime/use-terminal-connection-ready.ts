import { useCallback, useRef } from "react";

export interface UseTerminalConnectionReadyResult {
	markConnectionReady: (taskId: string) => void;
	prepareWaitForConnection: (taskId: string, timeoutMs?: number) => () => Promise<void>;
}

export function useTerminalConnectionReady(): UseTerminalConnectionReadyResult {
	const connectionTokenByTaskIdRef = useRef<Record<string, number>>({});

	const markConnectionReady = useCallback((taskId: string) => {
		const current = connectionTokenByTaskIdRef.current[taskId] ?? 0;
		connectionTokenByTaskIdRef.current[taskId] = current + 1;
	}, []);

	const waitForConnectionSince = useCallback(
		async (taskId: string, previousToken: number, timeoutMs = 2500): Promise<void> => {
			if (typeof window === "undefined") {
				return;
			}
			await new Promise<void>((resolve) => {
				const startedAt = Date.now();
				const poll = () => {
					const currentToken = connectionTokenByTaskIdRef.current[taskId] ?? 0;
					if (currentToken > previousToken) {
						resolve();
						return;
					}
					if (Date.now() - startedAt >= timeoutMs) {
						resolve();
						return;
					}
					window.setTimeout(poll, 40);
				};
				poll();
			});
		},
		[],
	);

	const prepareWaitForConnection = useCallback(
		(taskId: string, timeoutMs = 2500) => {
			const previousToken = connectionTokenByTaskIdRef.current[taskId] ?? 0;
			return async () => {
				await waitForConnectionSince(taskId, previousToken, timeoutMs);
			};
		},
		[waitForConnectionSince],
	);

	return {
		markConnectionReady,
		prepareWaitForConnection,
	};
}
