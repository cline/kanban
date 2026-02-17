import { useCallback, useEffect, useRef } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentMessage } from "@/kanban/chat/components/agent-message";
import { AgentThoughtBlock } from "@/kanban/chat/components/agent-thought-block";
import { MessageBubble } from "@/kanban/chat/components/message-bubble";
import { PermissionRequestBlock } from "@/kanban/chat/components/permission-request-block";
import { PlanBlock } from "@/kanban/chat/components/plan-block";
import { ToolCallBlock } from "@/kanban/chat/components/tool-call-block";
import type { ChatTimelineEntry } from "@/kanban/chat/types";

function TimelineEntry({
	entry,
	onPermissionRespond,
}: {
	entry: ChatTimelineEntry;
	onPermissionRespond: (messageId: string, optionId: string) => void;
}): React.ReactElement {
	switch (entry.type) {
		case "user_message":
			return <MessageBubble message={entry} />;
		case "agent_message":
			return <AgentMessage message={entry} />;
		case "agent_thought":
			return <AgentThoughtBlock thought={entry} />;
		case "tool_call":
			return <ToolCallBlock message={entry} />;
		case "plan":
			return <PlanBlock message={entry} />;
		case "permission_request":
			return <PermissionRequestBlock message={entry} onRespond={onPermissionRespond} />;
	}
}

const SCROLL_THRESHOLD = 80;

export function ChatMessageList({
	timeline,
	onPermissionRespond,
}: {
	timeline: ChatTimelineEntry[];
	onPermissionRespond: (messageId: string, optionId: string) => void;
}): React.ReactElement {
	const containerRef = useRef<HTMLDivElement>(null);
	const isAtBottomRef = useRef(true);

	// Find the Radix ScrollArea viewport (the actual scrollable element)
	const getViewport = useCallback((): HTMLElement | null => {
		return containerRef.current?.querySelector("[data-slot='scroll-area-viewport']") ?? null;
	}, []);

	// Track scroll position
	useEffect(() => {
		const viewport = getViewport();
		if (!viewport) return;

		function handleScroll() {
			if (!viewport) return;
			isAtBottomRef.current =
				viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < SCROLL_THRESHOLD;
		}

		viewport.addEventListener("scroll", handleScroll, { passive: true });
		return () => viewport.removeEventListener("scroll", handleScroll);
	}, [getViewport]);

	// Auto-scroll when timeline changes and user is near bottom
	useEffect(() => {
		if (!isAtBottomRef.current) return;
		const viewport = getViewport();
		if (!viewport) return;

		requestAnimationFrame(() => {
			viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
		});
	}, [timeline.length, timeline[timeline.length - 1], getViewport]);

	return (
		<div ref={containerRef} className="min-h-0 flex-1 overflow-hidden">
			<ScrollArea className="h-full">
				<div className="space-y-3 px-3 py-4">
					{timeline.map((entry) => (
						<TimelineEntry
							key={entry.id}
							entry={entry}
							onPermissionRespond={onPermissionRespond}
						/>
					))}
				</div>
			</ScrollArea>
		</div>
	);
}
