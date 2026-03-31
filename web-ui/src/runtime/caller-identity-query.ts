// Fetches the current caller's identity from the server.
// Returns null if no identity is available (e.g. localhost with no Cline account).
// Used to stamp createdBy on newly created board cards.

import { useEffect, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { BoardCardCreatedBy } from "@/types";

export async function fetchCallerIdentity(workspaceId: string | null): Promise<BoardCardCreatedBy | null> {
	try {
		const trpcClient = getRuntimeTrpcClient(workspaceId);
		return await trpcClient.remote.getCallerIdentity.query();
	} catch {
		return null;
	}
}

export function useCallerIdentity(workspaceId: string | null): BoardCardCreatedBy | null {
	const [callerIdentity, setCallerIdentity] = useState<BoardCardCreatedBy | null>(null);

	useEffect(() => {
		let cancelled = false;
		fetchCallerIdentity(workspaceId).then((identity) => {
			if (!cancelled) {
				setCallerIdentity(identity);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [workspaceId]);

	return callerIdentity;
}
