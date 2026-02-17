import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import type { ChatSlashCommand } from "@/kanban/chat/types";

export function SlashCommandPicker({
	commands,
	onSelect,
}: {
	commands: ChatSlashCommand[];
	onSelect: (command: ChatSlashCommand) => void;
}): React.ReactElement {
	return (
		<div className="absolute bottom-full left-0 right-0 mb-1">
			<Command className="rounded-lg border border-zinc-700 bg-zinc-800 shadow-xl">
				<CommandList>
					<CommandEmpty className="py-3 text-center text-xs text-zinc-500">
						No commands found
					</CommandEmpty>
					<CommandGroup>
						{commands.map((cmd) => (
							<CommandItem
								key={cmd.name}
								onSelect={() => onSelect(cmd)}
								className="cursor-pointer gap-3"
							>
								<span className="shrink-0 font-mono text-sm text-amber-400">/{cmd.name}</span>
								<span className="min-w-0 flex-1 truncate text-sm text-zinc-400">
									{cmd.description}
								</span>
								{cmd.input ? (
									<span className="shrink-0 text-xs text-zinc-600">({cmd.input.hint})</span>
								) : null}
							</CommandItem>
						))}
					</CommandGroup>
				</CommandList>
			</Command>
		</div>
	);
}
