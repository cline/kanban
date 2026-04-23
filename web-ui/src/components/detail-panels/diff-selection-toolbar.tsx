import { Send } from "lucide-react";
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
export function formatSnippetReference(range: DiffHighlightRange): string {
	const loc =
		range.startLine === range.endLine
			? `${range.filePath}:${range.startLine}`
			: `${range.filePath}:${range.startLine}-${range.endLine}`;
	return `${loc}\n\`\`\`\n${range.text}\n\`\`\``;
}

/**
 * Inline comment box rendered directly below the last highlighted diff row.
 * "Send" posts the snippet reference + user comment to the agent terminal.
 * "Cancel" (or Escape) dismisses the highlight and closes the box.
 */
export function DiffHighlightCommentBox({
	range,
	onSend,
	onCancel,
}: {
	range: DiffHighlightRange;
	onSend: (formatted: string) => void;
	onCancel: () => void;
}): React.ReactElement {
	const [text, setText] = useState("");
	const textAreaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		requestAnimationFrame(() => textAreaRef.current?.focus());
	}, []);

	const handleSend = useCallback(() => {
		const comment = text.trim();
		if (comment.length === 0) {
			return;
		}
		const snippet = formatSnippetReference(range);
		const message = `${snippet}\n\n${comment}`;
		onSend(message);
	}, [onSend, range, text]);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				onCancel();
				return;
			}
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				handleSend();
			}
		},
		[handleSend, onCancel],
	);

	return (
		<div className="kb-diff-highlight-comment-box" onClick={(e) => e.stopPropagation()}>
			<textarea
				ref={textAreaRef}
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder="Comment on this code..."
				rows={2}
				className="w-full rounded-md border-none bg-surface-2 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-border-bright resize-none"
			/>
			<div className="kb-diff-highlight-comment-actions">
				<Button variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					variant="primary"
					size="sm"
					disabled={text.trim().length === 0}
					icon={<Send size={14} />}
					onClick={handleSend}
				>
					Send
				</Button>
			</div>
		</div>
	);
}
