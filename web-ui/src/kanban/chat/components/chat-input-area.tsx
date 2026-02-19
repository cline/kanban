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
	showMoveToTrash,
	onMoveToTrash,
	disabled,
	disabledReason,
}: {
	status: ChatSessionStatus;
	availableCommands: ChatSlashCommand[];
	onSend: (text: string) => void;
	onCancel: () => void;
	showMoveToTrash?: boolean;
	onMoveToTrash?: () => void;
	disabled?: boolean;
	disabledReason?: string;
}): React.ReactElement {
	const [inputValue, setInputValue] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const isBusy = status !== "idle";
	const isInputDisabled = isBusy || Boolean(disabled);

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
		if (!trimmed || isInputDisabled) return;
		onSend(trimmed);
		setInputValue("");
	}, [inputValue, isInputDisabled, onSend]);

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
		<div className="bg-background">
			{showMoveToTrash && onMoveToTrash ? (
				<div className="border-t border-border px-3 py-2">
					<Button
						variant="destructive"
						size="sm"
						onClick={onMoveToTrash}
						className="w-full border border-red-500/30 bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-400"
					>
						Move to trash
					</Button>
				</div>
			) : null}
			<div className="border-t border-border p-3">
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
					disabled={isInputDisabled}
					placeholder={
						isBusy
							? "Agent is working..."
							: disabledReason || (disabled ? "Move this card to In Progress to start agent work." : "Send a message...")
					}
					rows={1}
					className="min-h-9 resize-none border-border bg-card text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-0"
				/>
				</div>

				<div className="mt-2 flex items-center justify-between">
					<span className="text-xs text-muted-foreground">{disabledReason ?? "Type / for commands"}</span>
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
							disabled={!inputValue.trim() || isInputDisabled}
							className="bg-amber-500 text-zinc-900 hover:bg-amber-400"
						>
							<SendHorizontal className="size-3.5" />
							Send
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
