import { useCallback, useMemo } from "react";

import type { ChatSlashCommand } from "@/kanban/chat/types";

export function useSlashCommands(
	inputValue: string,
	availableCommands: ChatSlashCommand[],
): {
	isOpen: boolean;
	filteredCommands: ChatSlashCommand[];
	selectCommand: (command: ChatSlashCommand) => string; // returns new input value
} {
	// Picker is open when input starts with / and has no space yet (typing the command name)
	const isTypingCommand = inputValue.startsWith("/") && !inputValue.includes(" ");
	const prefix = isTypingCommand ? inputValue.slice(1).toLowerCase() : "";

	const filteredCommands = useMemo(() => {
		if (!isTypingCommand) return [];
		return availableCommands.filter((cmd) => cmd.name.toLowerCase().startsWith(prefix));
	}, [isTypingCommand, prefix, availableCommands]);

	const isOpen = isTypingCommand && filteredCommands.length > 0;

	const selectCommand = useCallback((command: ChatSlashCommand): string => {
		return `/${command.name} `;
	}, []);

	return { isOpen, filteredCommands, selectCommand };
}
