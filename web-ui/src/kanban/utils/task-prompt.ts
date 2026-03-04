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

export interface TaskPromptWidthSplitOptions {
	maxTitleWidthPx: number;
	measureText: (value: string) => number;
}

function combineDescriptionParts(...parts: Array<string | null | undefined>): string {
	return parts
		.map((part) => part?.trim() ?? "")
		.filter((part) => part.length > 0)
		.join("\n\n");
}

function splitFirstLineByWidth(
	firstLine: string,
	options: TaskPromptWidthSplitOptions,
): { title: string; overflow: string } {
	const normalizedFirstLine = firstLine.trim();
	if (!normalizedFirstLine) {
		return { title: "", overflow: "" };
	}

	const maxWidth = Math.max(0, options.maxTitleWidthPx);
	if (maxWidth <= 0 || options.measureText(normalizedFirstLine) <= maxWidth) {
		return { title: normalizedFirstLine, overflow: "" };
	}

	let low = 1;
	let high = normalizedFirstLine.length;
	let fitIndex = 1;

	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const candidate = normalizedFirstLine.slice(0, middle);
		if (options.measureText(candidate) <= maxWidth) {
			fitIndex = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}

	let breakIndex = fitIndex;
	const lastSpace = normalizedFirstLine.lastIndexOf(" ", fitIndex - 1);
	if (lastSpace > 0) {
		breakIndex = lastSpace;
	}

	let title = normalizedFirstLine.slice(0, breakIndex).trimEnd();
	if (!title) {
		title = normalizedFirstLine.slice(0, fitIndex).trimEnd();
	}
	const overflow = normalizedFirstLine.slice(title.length).trimStart();
	return {
		title,
		overflow,
	};
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
	return {
		title: firstLine.trim(),
		description: rest,
	};
}

export function splitPromptToTitleDescriptionByWidth(
	prompt: string,
	options: TaskPromptWidthSplitOptions,
): TaskPromptSplit {
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
	const split = splitFirstLineByWidth(firstLine, options);
	return {
		title: split.title,
		description: combineDescriptionParts(split.overflow, rest),
	};
}
