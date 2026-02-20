const MAX_TITLE_LENGTH = 100;
const MIN_WORD_BOUNDARY = 50;

export const DISALLOWED_TASK_KICKOFF_SLASH_COMMANDS = [
	"help",
	"compact",
	"init",
	"status",
	"plan",
	"mcp",
] as const;

export interface TaskPromptSplit {
	title: string;
	description: string;
}

export function splitPromptToTitleDescription(prompt: string): TaskPromptSplit {
	const trimmed = prompt.trim();
	if (!trimmed) {
		return {
			title: "",
			description: "",
		};
	}

	const lines = trimmed.split(/\r?\n/g);
	const firstLine = lines[0] ?? "";
	const rest = lines.slice(1).join("\n").trim();

	if (firstLine.length <= MAX_TITLE_LENGTH) {
		return {
			title: firstLine,
			description: rest,
		};
	}

	const truncated = firstLine.slice(0, MAX_TITLE_LENGTH);
	const lastSpace = truncated.lastIndexOf(" ");
	if (lastSpace > MIN_WORD_BOUNDARY) {
		const title = truncated.slice(0, lastSpace);
		const overflow = firstLine.slice(lastSpace + 1).trim();
		return {
			title,
			description: rest ? `${overflow}\n\n${rest}` : overflow,
		};
	}

	const overflow = firstLine.slice(MAX_TITLE_LENGTH).trim();
	return {
		title: truncated,
		description: rest ? `${overflow}\n\n${rest}` : overflow,
	};
}
