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

export interface ParseMarkdownTaskPromptsOptions {
	sourcePath?: string;
}

export const DEFAULT_TASK_PROMPT_LABEL_MAX_CHARS = 100;
export const IMPORTABLE_MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdx"] as const;

const EXECUTION_HEADING_KEYWORDS = [
	"plan",
	"planned work",
	"implementation",
	"execution",
	"phase",
	"phases",
	"task",
	"tasks",
	"deliverables",
	"milestone",
	"milestones",
	"next steps",
	"checklist",
	"todo",
] as const;

const NUMBERED_LIST_REGEX = /^(\s*)\d+[.)]\s+(.+)$/;
const BULLET_LIST_REGEX = /^(\s*)[-*+•]\s+(.+)$/;
const UNCHECKED_CHECKLIST_REGEX = /^(\s*)[-*+]\s+\[\s\]\s+(.+)$/;
const CHECKED_CHECKLIST_REGEX = /^(\s*)[-*+]\s+\[[xX]\]\s+(.+)$/;
const HEADING_REGEX = /^#{1,6}\s+(.+?)\s*#*\s*$/;

function normalizePromptForDisplay(prompt: string): string {
	return prompt.replaceAll(/\s+/g, " ").trim();
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

function getIndentWidth(value: string): number {
	let width = 0;
	for (const character of value) {
		if (character === " ") {
			width += 1;
			continue;
		}
		if (character === "\t") {
			width += 4;
			continue;
		}
		break;
	}
	return width;
}

function normalizeHeadingText(value: string): string {
	return value.toLowerCase().replaceAll(/[^a-z0-9\s]+/g, " ").replaceAll(/\s+/g, " ").trim();
}

function isExecutionHeading(value: string): boolean {
	const normalizedValue = normalizeHeadingText(value);
	return EXECUTION_HEADING_KEYWORDS.some((keyword) => {
		return (
			normalizedValue === keyword ||
			normalizedValue.startsWith(`${keyword} `) ||
			normalizedValue.endsWith(` ${keyword}`) ||
			normalizedValue.includes(` ${keyword} `)
		);
	});
}

function isFenceDelimiter(value: string): boolean {
	return value.startsWith("```") || value.startsWith("~~~");
}

function normalizeImportedPrompt(rawValue: string): string {
	let normalizedValue = rawValue.trim();
	if (!normalizedValue) {
		return "";
	}

	normalizedValue = normalizedValue.replaceAll(/!\[[^\]]*\]\([^)]*\)/g, " ");
	normalizedValue = normalizedValue.replaceAll(/\[([^\]]+)\]\([^)]*\)/g, "$1");
	normalizedValue = normalizedValue.replaceAll(/`([^`]+)`/g, "$1");
	normalizedValue = normalizedValue.replaceAll(/(^|\W)\*\*([^*]+)\*\*(?=\W|$)/g, "$1$2");
	normalizedValue = normalizedValue.replaceAll(/(^|\W)\*([^*]+)\*(?=\W|$)/g, "$1$2");
	normalizedValue = normalizedValue.replaceAll(/(^|\W)__([^_]+)__(?=\W|$)/g, "$1$2");
	normalizedValue = normalizedValue.replaceAll(/(^|\W)_([^_]+)_(?=\W|$)/g, "$1$2");
	normalizedValue = normalizedValue.replaceAll(/(^|\W)~~([^~]+)~~(?=\W|$)/g, "$1$2");
	normalizedValue = normalizedValue.replaceAll(/`+/g, "");
	return normalizePromptForDisplay(normalizedValue);
}

function buildImportedPrompt(prompt: string, sourcePath?: string): string {
	if (!sourcePath) {
		return prompt;
	}
	const sourceMention = `@${sourcePath}`;
	if (prompt.includes(sourceMention)) {
		return prompt;
	}
	return `${prompt} ${sourceMention}`;
}

function extractTopLevelListItem(line: string): string | null {
	const numberedMatch = NUMBERED_LIST_REGEX.exec(line);
	if (numberedMatch && getIndentWidth(numberedMatch[1] ?? "") <= 3) {
		return numberedMatch[2]?.trim() ?? null;
	}
	const bulletMatch = BULLET_LIST_REGEX.exec(line);
	if (bulletMatch && getIndentWidth(bulletMatch[1] ?? "") <= 3) {
		return bulletMatch[2]?.trim() ?? null;
	}
	return null;
}

export function parseTaskListItems(text: string): string[] {
	const lines = text.split("\n");
	const nonEmptyLines = lines.filter((line) => line.trim().length > 0);

	if (nonEmptyLines.length < 2) {
		return [];
	}

	const numberedItems = nonEmptyLines.map((line) => NUMBERED_LIST_REGEX.exec(line));
	if (numberedItems.every((match) => match !== null)) {
		return numberedItems.map((match) => match?.[2]?.trim() ?? "");
	}

	const bulletItems = nonEmptyLines.map((line) => BULLET_LIST_REGEX.exec(line));
	if (bulletItems.every((match) => match !== null)) {
		return bulletItems.map((match) => match?.[2]?.trim() ?? "");
	}

	return [];
}

export function isImportableMarkdownPath(path: string): boolean {
	const normalizedPath = path.trim().toLowerCase();
	return IMPORTABLE_MARKDOWN_EXTENSIONS.some((extension) => normalizedPath.endsWith(extension));
}

export function parseMarkdownTaskPrompts(
	markdown: string,
	options: ParseMarkdownTaskPromptsOptions = {},
): string[] {
	const prompts: string[] = [];
	const seenPrompts = new Set<string>();
	const sourcePath = options.sourcePath?.trim();
	const lines = markdown.split(/\r?\n/g);
	let inCodeFence = false;
	let seenHeadings = false;
	let currentHeadingEligible = false;

	const collectPrompt = (rawPrompt: string) => {
		const normalizedPrompt = normalizeImportedPrompt(rawPrompt);
		if (!normalizedPrompt) {
			return;
		}
		if (seenPrompts.has(normalizedPrompt)) {
			return;
		}
		seenPrompts.add(normalizedPrompt);
		prompts.push(buildImportedPrompt(normalizedPrompt, sourcePath));
	};

	for (const line of lines) {
		const trimmedLine = line.trim();
		if (isFenceDelimiter(trimmedLine)) {
			inCodeFence = !inCodeFence;
			continue;
		}
		if (inCodeFence) {
			continue;
		}

		const headingMatch = HEADING_REGEX.exec(trimmedLine);
		if (headingMatch) {
			seenHeadings = true;
			currentHeadingEligible = isExecutionHeading(headingMatch[1] ?? "");
			continue;
		}

		const checkedChecklistMatch = CHECKED_CHECKLIST_REGEX.exec(line);
		if (checkedChecklistMatch && getIndentWidth(checkedChecklistMatch[1] ?? "") <= 3) {
			continue;
		}

		const uncheckedChecklistMatch = UNCHECKED_CHECKLIST_REGEX.exec(line);
		if (uncheckedChecklistMatch && getIndentWidth(uncheckedChecklistMatch[1] ?? "") <= 3) {
			collectPrompt(uncheckedChecklistMatch[2] ?? "");
			continue;
		}

		if (!currentHeadingEligible && seenHeadings) {
			continue;
		}

		const listItem = extractTopLevelListItem(line);
		if (!listItem) {
			continue;
		}
		collectPrompt(listItem);
	}

	return prompts;
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
