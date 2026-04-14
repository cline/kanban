import { normalizeUserInput } from "@clinebot/shared";
import { Brain, ChevronDown, ChevronRight, XCircle } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import {
	formatToolInputForDisplay,
	getToolDisplay,
	parseToolMessageContent,
	parseToolOutput,
} from "@/components/detail-panels/cline-chat-message-utils";
import { ClineMarkdownContent } from "@/components/detail-panels/cline-markdown-content";
import { TaskImageStrip } from "@/components/task-image-strip";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import type { ClineChatMessage } from "@/hooks/use-cline-chat-session";

function ToolMessageBlock({ message }: { message: ClineChatMessage }): ReactElement {
	const parsed = useMemo(() => parseToolMessageContent(message.content), [message.content]);
	const isRunning = message.meta?.hookEventName === "tool_call_start";
	const hasError = Boolean(parsed.error);
	const [expanded, setExpanded] = useState(false);

	const toolDisplay = useMemo(() => getToolDisplay(parsed.toolName, parsed.input), [parsed.toolName, parsed.input]);
	const toolOutput = useMemo(() => (parsed.output ? parseToolOutput(parsed.output) : null), [parsed.output]);
	const fullInput = useMemo(
		() => formatToolInputForDisplay(parsed.toolName, parsed.input),
		[parsed.toolName, parsed.input],
	);
	const hasExpandableContent = Boolean(parsed.output || parsed.error || fullInput);

	return (
		<div className="w-full">
			<button
				type="button"
				onClick={hasExpandableContent ? () => setExpanded((e) => !e) : undefined}
				className={cn(
					"group flex w-full items-center gap-1.5 rounded px-1.5 py-0 text-left text-sm",
					hasExpandableContent && "cursor-pointer",
				)}
			>
				{isRunning ? (
					<Spinner size={14} className="shrink-0" />
				) : hasError ? (
					<XCircle size={14} className="shrink-0 text-status-red" />
				) : null}
				<span
					className={cn(
						"shrink-0 font-semibold group-hover:text-text-primary",
						expanded ? "text-text-primary" : "text-text-secondary",
					)}
				>
					{toolDisplay.toolName}
				</span>
				{toolDisplay.inputSummary ? (
					<span
						className={cn(
							"min-w-0 truncate group-hover:text-text-secondary",
							expanded ? "text-text-secondary" : "text-text-tertiary",
						)}
					>
						{toolDisplay.inputSummary}
					</span>
				) : null}
				{hasExpandableContent ? (
					<span
						className={cn(
							"shrink-0 group-hover:text-text-secondary",
							expanded ? "text-text-secondary" : "text-text-tertiary",
						)}
					>
						{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
					</span>
				) : null}
			</button>

			{expanded ? (
				<div className="mt-1 space-y-1.5 pr-1.5 pl-[24px] pb-1">
					{/* Full tool input (e.g. complete run_commands commands) */}
					{fullInput ? (
						<div>
							<div className="mb-0.5 text-xs text-text-tertiary">Command</div>
							<pre className="max-h-60 overflow-auto rounded bg-surface-0 px-2 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-all text-text-primary">
								{fullInput}
							</pre>
						</div>
					) : null}

					{/* Parsed ToolOperationResult output */}
					{toolOutput ? (
						toolOutput.results.map((result, i) => (
							<div key={i}>
								{toolOutput.results.length > 1 ? (
									<div className="mb-0.5 truncate text-xs text-text-tertiary">{result.query}</div>
								) : null}
								{result.error ? (
									<pre className="max-h-60 overflow-auto rounded bg-status-red/5 px-2 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-all text-status-red">
										{result.error}
									</pre>
								) : null}
								{result.content ? (
									<pre className="max-h-60 overflow-auto rounded bg-surface-0 px-2 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-all text-text-primary">
										{result.content}
									</pre>
								) : null}
							</div>
						))
					) : parsed.output ? (
						/* Fallback for non-ToolOperationResult output (skills, ask_question, MCP tools) */
						<div>
							<div className="mb-0.5 text-xs text-text-tertiary">Output</div>
							<pre className="max-h-60 overflow-auto rounded bg-surface-0 px-2 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-all text-text-primary">
								{parsed.output}
							</pre>
						</div>
					) : null}

					{/* Tool-level error (SDK crash/timeout, separate from per-result errors) */}
					{parsed.error ? (
						<div>
							<div className="mb-0.5 text-xs text-status-red">Error</div>
							<pre className="max-h-60 overflow-auto rounded bg-status-red/5 px-2 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-all text-status-red">
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
			<div className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wide text-status-purple">
				<Brain size={12} />
				<span>Reasoning</span>
			</div>
			<div className="w-full text-sm whitespace-pre-wrap break-words text-text-secondary">{message.content}</div>
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
		const hasText = message.content.trim().length > 0;
		const hasImages = Boolean(message.images && message.images.length > 0);
		return (
			<div className="ml-auto max-w-[85%] rounded-md bg-accent/10 border border-accent/20 px-3 py-2 text-sm text-text-primary">
				{hasText ? (
					<div className="whitespace-pre-wrap break-words">{normalizeUserInput(message.content)}</div>
				) : null}
				{hasImages ? (
					<TaskImageStrip images={message.images ?? []} className={hasText ? "mt-2" : undefined} />
				) : null}
			</div>
		);
	}
	if (message.role === "assistant") {
		const normalizedAssistantContent = message.content.replace(/^\n+/, "");
		return (
			<div className="min-w-0 w-full px-1.5 text-sm text-text-primary">
				<ClineMarkdownContent content={normalizedAssistantContent} />
			</div>
		);
	}
	const label = message.role === "status" ? "Status" : "System";
	return (
		<div className="max-w-[85%] rounded-md border border-border bg-surface-3/70 px-3 py-2 text-sm whitespace-pre-wrap break-all text-text-secondary">
			<div className="mb-1 text-xs uppercase tracking-wide text-text-tertiary">{label}</div>
			{message.content}
		</div>
	);
}
