import { type ReactElement, useMemo, useState } from "react";
import { Brain, ChevronDown, ChevronRight, Wrench } from "lucide-react";

import { ClineMarkdownContent } from "@/components/detail-panels/cline-markdown-content";
import { parseToolMessageContent } from "@/components/detail-panels/cline-chat-message-utils";
import type { ClineChatMessage } from "@/hooks/use-cline-chat-session";

function ToolMessageBlock({ message }: { message: ClineChatMessage }): ReactElement {
	const parsed = useMemo(() => parseToolMessageContent(message.content), [message.content]);
	const isRunning = message.meta?.hookEventName === "tool_call_start";
	const hasError = Boolean(parsed.error);
	const [expanded, setExpanded] = useState(false);
	const statusText = hasError ? "Failed" : isRunning ? "Running" : "Completed";
	const statusClasses = hasError
		? "text-status-red"
		: isRunning
			? "text-status-orange"
			: "text-status-green";

	return (
		<div className="w-full rounded-md border border-border bg-status-blue/5 px-2 py-2">
			<button
				type="button"
				onClick={() => setExpanded((current) => !current)}
				className="flex w-full items-center justify-between gap-2 text-left"
			>
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-xs uppercase tracking-wide text-text-tertiary">
						<Wrench size={12} />
						<span>Tool</span>
						<span className={statusClasses}>{statusText}</span>
					</div>
					<div className="truncate text-sm text-text-primary">{parsed.toolName}</div>
				</div>
				<div className="flex items-center gap-2 text-xs text-text-secondary">
					{typeof parsed.durationMs === "number" ? <span>{parsed.durationMs}ms</span> : null}
					{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				</div>
			</button>
			{expanded ? (
				<div className="mt-2 space-y-2">
					{parsed.input ? (
						<div>
							<div className="mb-1 text-[11px] uppercase tracking-wide text-text-tertiary">Input</div>
							<pre className="max-h-44 overflow-auto rounded border border-border bg-surface-1 px-2 py-1 text-xs whitespace-pre-wrap break-all text-text-secondary">
								{parsed.input}
							</pre>
						</div>
					) : null}
					{parsed.output ? (
						<div>
							<div className="mb-1 text-[11px] uppercase tracking-wide text-text-tertiary">Output</div>
							<pre className="max-h-56 overflow-auto rounded border border-border bg-surface-1 px-2 py-1 text-xs whitespace-pre-wrap break-all text-text-primary">
								{parsed.output}
							</pre>
						</div>
					) : null}
					{parsed.error ? (
						<div>
							<div className="mb-1 text-[11px] uppercase tracking-wide text-status-red">Error</div>
							<pre className="max-h-56 overflow-auto rounded border border-status-red/40 bg-status-red/10 px-2 py-1 text-xs whitespace-pre-wrap break-all text-status-red">
								{parsed.error}
							</pre>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function ReasoningMessageBlock({ message }: { message: ClineChatMessage }): ReactElement {
	return (
		<div className="w-full">
			<div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-status-purple">
				<Brain size={12} />
				<span>Reasoning</span>
			</div>
			<div className="w-full text-sm whitespace-pre-wrap text-text-secondary">{message.content}</div>
		</div>
	);
}

export function ClineChatMessageItem({ message }: { message: ClineChatMessage }): ReactElement {
	if (message.role === "tool") {
		return <ToolMessageBlock message={message} />;
	}
	if (message.role === "reasoning") {
		return <ReasoningMessageBlock message={message} />;
	}
	if (message.role === "user") {
		return (
			<div className="ml-auto max-w-[85%] rounded-md bg-accent/20 px-3 py-2 text-sm whitespace-pre-wrap text-text-primary">
				{message.content}
			</div>
		);
	}
	if (message.role === "assistant") {
		const normalizedAssistantContent = message.content.replace(/^\n+/, "");
		return (
			<div className="w-full text-sm whitespace-pre-wrap text-text-primary">
				<ClineMarkdownContent content={normalizedAssistantContent} />
			</div>
		);
	}
	const label = message.role === "status" ? "Status" : "System";
	return (
		<div className="max-w-[85%] rounded-md border border-border bg-surface-3/70 px-3 py-2 text-sm whitespace-pre-wrap text-text-secondary">
			<div className="mb-1 text-[11px] uppercase tracking-wide text-text-tertiary">{label}</div>
			{message.content}
		</div>
	);
}
