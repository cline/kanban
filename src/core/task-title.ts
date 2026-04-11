export const DEFAULT_TASK_TITLE_MAX_CHARS = 80;

function normalizeTaskTitleWhitespace(value: string): string {
	return value.replaceAll(/\s+/g, " ").trim();
}

function truncateTaskTitle(value: string, maxChars: number): string {
	if (maxChars <= 0) {
		return "";
	}
	if (value.length <= maxChars) {
		return value;
	}
	return `${value.slice(0, maxChars).trimEnd()}…`;
}

export function deriveTaskTitleFromPrompt(prompt: string, maxChars = DEFAULT_TASK_TITLE_MAX_CHARS): string {
	const firstNonEmptyLine =
		prompt
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.find((line) => line.length > 0) ?? "";
	const normalizedLine = normalizeTaskTitleWhitespace(firstNonEmptyLine);
	if (!normalizedLine) {
		return "";
	}
	const firstSentenceMatch = normalizedLine.match(/^(.+?[.!?])(?:\s|$)/u);
	const sentenceOrLine = firstSentenceMatch?.[1] ?? normalizedLine;
	return truncateTaskTitle(sentenceOrLine, maxChars);
}

export function resolveTaskTitle(title: string | null | undefined, prompt: string): string {
	const normalizedTitle = normalizeTaskTitleWhitespace(title ?? "");
	if (normalizedTitle) {
		return truncateTaskTitle(normalizedTitle, DEFAULT_TASK_TITLE_MAX_CHARS);
	}
	return deriveTaskTitleFromPrompt(prompt);
}
