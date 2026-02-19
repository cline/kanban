import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ChatAgentThought } from "@/kanban/chat/types";

export function AgentThoughtBlock({ thought }: { thought: ChatAgentThought }): React.ReactElement {
	const [open, setOpen] = useState(true);
	const wasStreamingRef = useRef(thought.isStreaming);

	// Auto-collapse when streaming ends
	useEffect(() => {
		if (wasStreamingRef.current && !thought.isStreaming) {
			const timeout = setTimeout(() => setOpen(false), 500);
			return () => clearTimeout(timeout);
		}
		wasStreamingRef.current = thought.isStreaming;
	}, [thought.isStreaming]);

	const lineCount = thought.text.split("\n").length;
	const Chevron = open ? ChevronDown : ChevronRight;

	return (
		<Collapsible open={open} onOpenChange={setOpen} className="border-l-2 border-zinc-600 pl-3">
			<CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-400">
				<Chevron className="size-3" />
				<span>
					{thought.isStreaming ? (
						<span className="animate-pulse">Thinking...</span>
					) : (
						`Thinking (${lineCount} lines)`
					)}
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<pre className="mt-1 min-w-0 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-zinc-500 [overflow-wrap:anywhere]">
					{thought.text}
				</pre>
			</CollapsibleContent>
		</Collapsible>
	);
}
