export const DISALLOWED_TASK_KICKOFF_SLASH_COMMANDS = ["help", "compact", "init", "status", "plan", "mcp"] as const;

export interface TaskPromptSplit {
	title: string;
	description: string;
}

export interface TaskPromptWidthSplitOptions {
	maxTitleWidthPx: number;
	measureText: (value: string) => number;
}

export const DEFAULT_TASK_PROMPT_LABEL_MAX_CHARS = 100;

function normalizePromptForDisplay(prompt: string): string {
	return prompt.replaceAll(/\s+/g, " ").trim();
}

function splitTextByWidth(text: string, options: TaskPromptWidthSplitOptions): { title: string; overflow: string } {
	const normalizedText = normalizePromptForDisplay(text);
	if (!normalizedText) {
		return { title: "", overflow: "" };
	}

	const maxWidth = Math.max(0, options.maxTitleWidthPx);
	if (maxWidth <= 0 || options.measureText(normalizedText) <= maxWidth) {
		return { title: normalizedText, overflow: "" };
	}

	let low = 1;
	let high = normalizedText.length;
	let fitIndex = 1;

	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const candidate = normalizedText.slice(0, middle);
		if (options.measureText(candidate) <= maxWidth) {
			fitIndex = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}

	let breakIndex = fitIndex;
	const lastSpace = normalizedText.lastIndexOf(" ", fitIndex - 1);
	if (lastSpace > 0) {
		breakIndex = lastSpace;
	}

	let title = normalizedText.slice(0, breakIndex).trimEnd();
	if (!title) {
		title = normalizedText.slice(0, fitIndex).trimEnd();
	}
	const overflow = normalizedText.slice(title.length).trimStart();
	return {
		title,
		overflow,
	};
}

export function truncateTaskPromptLabel(prompt: string, maxChars = DEFAULT_TASK_PROMPT_LABEL_MAX_CHARS): string {
	if (maxChars <= 0) {
		return "";
	}
	const normalized = normalizePromptForDisplay(prompt);
	if (normalized.length <= maxChars) {
		return normalized;
	}
	const truncated = normalized.slice(0, maxChars).trimEnd();
	return `${truncated}…`;
}

export function splitPromptToTitleDescriptionByWidth(
	prompt: string,
	options: TaskPromptWidthSplitOptions,
): TaskPromptSplit {
	const normalized = normalizePromptForDisplay(prompt);
	if (!normalized) {
		return {
			title: "",
			description: "",
		};
	}
	const split = splitTextByWidth(normalized, options);
	return {
		title: split.title,
		description: split.overflow,
	};
}
