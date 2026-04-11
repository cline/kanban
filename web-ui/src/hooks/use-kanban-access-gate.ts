import { useCallback, useEffect, useRef, useState } from "react";

import { fetchClineKanbanAccess } from "@/runtime/runtime-config-query";

interface UseKanbanAccessGateInput {
	workspaceId: string | null;
}

export function useKanbanAccessGate(input: UseKanbanAccessGateInput): { isBlocked: boolean; refresh: () => void } {
	const { workspaceId } = input;
	const [isBlocked, setIsBlocked] = useState(false);
	const generationRef = useRef(0);

	const check = useCallback(() => {
		const generation = ++generationRef.current;
		void fetchClineKanbanAccess(workspaceId)
			.then((response) => {
				if (generation !== generationRef.current) return;
				setIsBlocked(!response.enabled);
			})
			.catch(() => {
				if (generation !== generationRef.current) return;
				setIsBlocked(false);
			});
	}, [workspaceId]);

	useEffect(() => {
		check();
	}, [check]);

	return { isBlocked, refresh: check };
}
