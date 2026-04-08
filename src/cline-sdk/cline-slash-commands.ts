export interface ClineBuiltinSlashCommandDefinition {
	name: string;
	description: string;
}

export const CLINE_BUILTIN_SLASH_COMMANDS: readonly ClineBuiltinSlashCommandDefinition[] = [
	{
		name: "clear",
		description: "Start a fresh chat session and clear prior context.",
	},
];

function readLeadingSlashCommandName(text: string): string | null {
	const match = text.trim().match(/^\/([^\s]+)\s*$/);
	return match?.[1]?.toLowerCase() ?? null;
}

export function isClineClearSlashCommand(text: string): boolean {
	return readLeadingSlashCommandName(text) === "clear";
}
