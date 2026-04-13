import { MessageSquarePlus, Send, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

export interface DiffHighlightRange {
	filePath: string;
	startLine: number;
	endLine: number;
	/** The text of every highlighted line joined with newlines. */
	text: string;
}

/**
 * Format a highlight range into the snippet reference sent to the agent.
 * Example output:
 *   src/utils/foo.ts:5-12
 *   ```
 *   <code lines>
 *   ```
 */
function formatSnippetReference(range: DiffHighlightRange): string {
	const loc =
		range.startLine === range.endLine
			? `${range.filePath}:${range.startLine}`
			: `${range.filePath}:${range.startLine}-${range.endLine}`;
	return `${loc}\n\`\`\`\n${range.text}\n\`\`\``;
}

export function DiffSelectionToolbar({
	range,
	anchorTop,
	anchorLeft,
	onAddToChat,
	onSendToAgent,
	onDismiss,
}: {
	range: DiffHighlightRange;
	/** Top offset in px relative to the positioned scroll container. */
	anchorTop: number;
	/** Left offset in px relative to the positioned scroll container. */
	anchorLeft: number;
	onAddToChat: (formatted: string) => void;
	onSendToAgent?: (formatted: string) => void;
	onDismiss: () => void;
}): React.ReactElement {
	const [showAskDialog, setShowAskDialog] = useState(false);
	const [askText, setAskText] = useState("");
	const textAreaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (showAskDialog) {
			// Small delay so the dialog renders before focusing
			requestAnimationFrame(() => textAreaRef.current?.focus());
		}
	}, [showAskDialog]);

	const handleAddToChat = useCallback(() => {
		onAddToChat(formatSnippetReference(range));
		onDismiss();
	}, [onAddToChat, onDismiss, range]);

	const handleSubmitAsk = useCallback(() => {
		const comment = askText.trim();
		if (comment.length === 0 || !onSendToAgent) {
			return;
		}
		const snippet = formatSnippetReference(range);
		const message = `${snippet}\n\n${comment}`;
		onSendToAgent(message);
		setShowAskDialog(false);
		setAskText("");
		onDismiss();
	}, [askText, onDismiss, onSendToAgent, range]);

	const handleCancelAsk = useCallback(() => {
		setShowAskDialog(false);
		setAskText("");
	}, []);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				handleCancelAsk();
				return;
			}
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				handleSubmitAsk();
			}
		},
		[handleCancelAsk, handleSubmitAsk],
	);

	if (showAskDialog) {
		const lineRef =
			range.startLine === range.endLine
				? `${range.filePath}:${range.startLine}`
				: `${range.filePath}:${range.startLine}-${range.endLine}`;

		return (
			<div
				className="kb-diff-ask-dialog-backdrop"
				onMouseDown={(e) => {
					if (e.target === e.currentTarget) {
						handleCancelAsk();
					}
				}}
			>
				<div className="kb-diff-ask-dialog">
					<div className="kb-diff-ask-dialog-header">{lineRef}</div>
					<div className="kb-diff-ask-dialog-code">{range.text}</div>
					<div className="px-3 pb-2">
						<textarea
							ref={textAreaRef}
							value={askText}
							onChange={(e) => setAskText(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="Ask about this code..."
							rows={2}
							className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none resize-none"
						/>
					</div>
					<div className="kb-diff-ask-dialog-footer">
						<Button variant="ghost" size="sm" onClick={handleCancelAsk}>
							Cancel
						</Button>
						<Button
							variant="primary"
							size="sm"
							disabled={askText.trim().length === 0}
							icon={<Send size={14} />}
							onClick={handleSubmitAsk}
						>
							Submit
						</Button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div
			className="kb-diff-selection-toolbar"
			style={{
				top: anchorTop,
				left: anchorLeft,
				transform: "translateX(-50%)",
			}}
		>
			<Button variant="ghost" size="sm" icon={<MessageSquarePlus size={14} />} onClick={handleAddToChat}>
				Add to Chat
			</Button>
			{onSendToAgent ? (
				<Button variant="ghost" size="sm" icon={<Send size={14} />} onClick={() => setShowAskDialog(true)}>
					Ask Cline
				</Button>
			) : null}
			<Button
				variant="ghost"
				size="sm"
				icon={<X size={14} />}
				onClick={onDismiss}
				aria-label="Dismiss"
				className="!px-1"
			/>
		</div>
	);
}
