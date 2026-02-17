import { SendHorizontal, Square } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SlashCommandPicker } from "@/kanban/chat/components/slash-command-picker";
import { useSlashCommands } from "@/kanban/chat/hooks/use-slash-commands";
import type { ChatSessionStatus, ChatSlashCommand } from "@/kanban/chat/types";

export function ChatInputArea({
	status,
	availableCommands,
	onSend,
	onCancel,
}: {
	status: ChatSessionStatus;
	availableCommands: ChatSlashCommand[];
	onSend: (text: string) => void;
	onCancel: () => void;
}): React.ReactElement {
	const [inputValue, setInputValue] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const isBusy = status !== "idle";

	const { isOpen: isPickerOpen, filteredCommands, selectCommand } =
		useSlashCommands(inputValue, availableCommands);

	const handleSelectCommand = useCallback(
		(cmd: ChatSlashCommand) => {
			const newValue = selectCommand(cmd);
			setInputValue(newValue);
			textareaRef.current?.focus();
		},
		[selectCommand],
	);

	const handleSend = useCallback(() => {
		const trimmed = inputValue.trim();
		if (!trimmed || isBusy) return;
		onSend(trimmed);
		setInputValue("");
	}, [inputValue, isBusy, onSend]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			// Enter sends (Shift+Enter for newline), but not when picker is open (cmdk handles it)
			if (e.key === "Enter" && !e.shiftKey && !isPickerOpen) {
				e.preventDefault();
				handleSend();
			}
		},
		[isPickerOpen, handleSend],
	);

	return (
		<div className="border-t border-zinc-800 bg-zinc-900 p-3">
			<div className="relative">
				{isPickerOpen ? (
					<SlashCommandPicker
						commands={filteredCommands}
						onSelect={handleSelectCommand}
					/>
				) : null}

				<Textarea
					ref={textareaRef}
					value={inputValue}
					onChange={(e) => setInputValue(e.target.value)}
					onKeyDown={handleKeyDown}
					disabled={isBusy}
					placeholder={isBusy ? "Agent is working..." : "Send a message..."}
					rows={1}
					className="min-h-9 resize-none border-zinc-700 bg-zinc-800 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:border-zinc-600 focus-visible:ring-0"
				/>
			</div>

			<div className="mt-2 flex items-center justify-between">
				<span className="text-xs text-zinc-600">Type / for commands</span>
				{isBusy ? (
					<Button
						variant="destructive"
						size="sm"
						onClick={onCancel}
						className="border border-red-500/30 bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-400"
					>
						<Square className="size-3" />
						Cancel
					</Button>
				) : (
					<Button
						size="sm"
						onClick={handleSend}
						disabled={!inputValue.trim()}
						className="bg-amber-500 text-zinc-900 hover:bg-amber-400"
					>
						<SendHorizontal className="size-3.5" />
						Send
					</Button>
				)}
			</div>
		</div>
	);
}
