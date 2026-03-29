import { useEffect, useState } from "react";

import { fetchClineKanbanAccess } from "@/runtime/runtime-config-query";

interface UseKanbanAccessGateInput {
	workspaceId: string | null;
}

export function useKanbanAccessGate(input: UseKanbanAccessGateInput): { isBlocked: boolean } {
	const { workspaceId } = input;
	const [isBlocked, setIsBlocked] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void fetchClineKanbanAccess(workspaceId)
			.then((response) => {
				console.log(response);
				if (cancelled) {
					return;
				}
				setIsBlocked(!response.enabled);
			})
			.catch(() => {
				if (!cancelled) {
					setIsBlocked(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceId]);

	return { isBlocked };
}
