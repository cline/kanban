export interface TaskPromptSplit {
	title: string;
	description: string;
}

export interface TaskPromptWidthSplitOptions {
	maxTitleWidthPx: number;
	measureText: (value: string) => number;
}

export interface InlineSuffixClampOptions {
	maxWidthPx: number;
	maxLines: number;
	suffix: string;
	measureText: (value: string) => number;
}

export interface InlineSuffixClampResult {
	text: string;
	isTruncated: boolean;
}

export const DEFAULT_TASK_PROMPT_LABEL_MAX_CHARS = 100;

function normalizePromptForDisplay(prompt: string): string {
	return prompt.replaceAll(/\s+/g, " ").trim();
}

export function normalizeTaskTextForDisplay(value: string): string {
	return normalizePromptForDisplay(value);
}

function wrapTextByWidth(
	text: string,
	options: Pick<InlineSuffixClampOptions, "maxWidthPx" | "measureText">,
): string[] {
	const normalizedText = normalizePromptForDisplay(text);
	if (!normalizedText) {
		return [];
	}
	const maxWidth = Math.max(0, options.maxWidthPx);
	if (maxWidth <= 0) {
		return [normalizedText];
	}

	const lines: string[] = [];
	let startIndex = 0;

	while (startIndex < normalizedText.length) {
		let low = startIndex + 1;
		let high = normalizedText.length;
		let fitIndex = startIndex + 1;

		while (low <= high) {
			const middle = Math.floor((low + high) / 2);
			const candidate = normalizedText.slice(startIndex, middle);
			if (options.measureText(candidate) <= maxWidth) {
				fitIndex = middle;
				low = middle + 1;
			} else {
				high = middle - 1;
			}
		}

		let endIndex = fitIndex;
		if (endIndex < normalizedText.length) {
			const lastSpaceIndex = normalizedText.lastIndexOf(" ", endIndex - 1);
			if (lastSpaceIndex >= startIndex) {
				endIndex = lastSpaceIndex;
			}
		}

		const line = normalizedText.slice(startIndex, endIndex).trim();
		if (!line) {
			startIndex += 1;
			continue;
		}

		lines.push(line);
		startIndex = endIndex;
		while (normalizedText[startIndex] === " ") {
			startIndex += 1;
		}
	}

	return lines;
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

export function getTaskPromptDescription(prompt: string, title: string): string {
	const normalizedPrompt = normalizePromptForDisplay(prompt);
	const normalizedTitle = normalizePromptForDisplay(title);
	if (!normalizedPrompt) {
		return "";
	}
	if (!normalizedTitle) {
		return normalizedPrompt;
	}
	if (normalizedPrompt === normalizedTitle) {
		return "";
	}
	if (normalizedPrompt.startsWith(normalizedTitle)) {
		const remainder = normalizedPrompt.slice(normalizedTitle.length).replace(/^[\s:;,.!?-]+/u, "").trim();
		if (remainder.length > 0) {
			return remainder;
		}
	}
	return normalizedPrompt;
}

export function clampTextWithInlineSuffix(
	text: string,
	options: InlineSuffixClampOptions,
): InlineSuffixClampResult {
	const normalizedText = normalizePromptForDisplay(text);
	if (!normalizedText) {
		return {
			text: "",
			isTruncated: false,
		};
	}

	if (options.maxLines <= 0 || options.maxWidthPx <= 0) {
		return {
			text: normalizedText,
			isTruncated: false,
		};
	}

	const wrappedLines = wrapTextByWidth(normalizedText, options);
	if (wrappedLines.length <= options.maxLines) {
		return {
			text: normalizedText,
			isTruncated: false,
		};
	}

	let low = 0;
	let high = normalizedText.length;
	let bestFitIndex = 0;

	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const candidate = normalizedText.slice(0, middle).trimEnd();
		const lines = wrapTextByWidth(`${candidate}${options.suffix}`, options);
		if (lines.length <= options.maxLines) {
			bestFitIndex = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}

	let truncatedText = normalizedText.slice(0, bestFitIndex).trimEnd();
	if (bestFitIndex < normalizedText.length && normalizedText[bestFitIndex] !== " ") {
		const lastSpaceIndex = truncatedText.lastIndexOf(" ");
		if (lastSpaceIndex > 0) {
			truncatedText = truncatedText.slice(0, lastSpaceIndex).trimEnd();
		}
	}

	return {
		text: truncatedText,
		isTruncated: true,
	};
}
