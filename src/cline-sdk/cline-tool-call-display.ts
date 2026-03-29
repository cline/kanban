export interface ClineToolCallDisplay {
	toolName: string;
	inputSummary: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatArraySummary(values: unknown[]): string | null {
	if (values.length === 0) {
		return null;
	}
	const first = String(values[0]).split("\n")[0]?.trim();
	if (!first) {
		return null;
	}
	return values.length > 1 ? `${first} (+${values.length - 1} more)` : first;
}

function formatArrayList(values: unknown[]): string | null {
	const items = values
		.map((value) => String(value).split("\n")[0]?.trim())
		.filter((value): value is string => Boolean(value));

	if (items.length === 0) {
		return null;
	}

	return items.join(", ");
}

function normalizeToolName(toolName: string): string {
	return toolName.toLowerCase().replace(/[^a-z]/g, "");
}

function normalizeDisplayToolName(toolName: string | null | undefined): string {
	if (typeof toolName !== "string") {
		return "unknown";
	}
	const trimmed = toolName.trim();
	return trimmed.length > 0 ? trimmed : "unknown";
}

function summarizeStringInput(input: string): string | null {
	const firstLine = input.split("\n").find((line) => line.trim().length > 0);
	return firstLine ? firstLine.trim().slice(0, 120) : null;
}

function appendReadFileSummary(summaries: string[], value: unknown): void {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length > 0) {
			summaries.push(trimmed);
		}
		return;
	}

	if (!isRecord(value)) {
		return;
	}

	const path =
		typeof value.path === "string"
			? value.path.trim()
			: typeof value.file_path === "string"
				? value.file_path.trim()
				: typeof value.filePath === "string"
					? value.filePath.trim()
					: "";
	if (path.length === 0) {
		return;
	}

	const startLine = Number.isInteger(value.start_line) ? Number(value.start_line) : null;
	const endLine = Number.isInteger(value.end_line) ? Number(value.end_line) : null;

	if (startLine === null && endLine === null) {
		summaries.push(path);
		return;
	}

	const start = startLine ?? 1;
	const end = endLine ?? "EOF";
	summaries.push(`${path}:${start}-${end}`);
}

function extractReadFileSummaries(input: unknown): string[] {
	const summaries: string[] = [];

	if (typeof input === "string") {
		appendReadFileSummary(summaries, input);
		return Array.from(new Set(summaries));
	}

	if (Array.isArray(input)) {
		for (const value of input) {
			appendReadFileSummary(summaries, value);
		}
		return Array.from(new Set(summaries));
	}

	if (!isRecord(input)) {
		return summaries;
	}

	appendReadFileSummary(summaries, input);

	const filePaths = input.file_paths;
	if (typeof filePaths === "string") {
		appendReadFileSummary(summaries, filePaths);
	} else if (Array.isArray(filePaths)) {
		for (const value of filePaths) {
			appendReadFileSummary(summaries, value);
		}
	}

	const files = input.files;
	if (Array.isArray(files)) {
		for (const value of files) {
			appendReadFileSummary(summaries, value);
		}
	} else if (files !== undefined) {
		appendReadFileSummary(summaries, files);
	}

	return Array.from(new Set(summaries));
}

function parseToolInput(input: unknown): unknown {
	if (typeof input !== "string") {
		return input;
	}

	try {
		return JSON.parse(input) as unknown;
	} catch {
		return input;
	}
}

function summarizeParsedToolInput(toolName: string, input: unknown): string | null {
	if (input === null || input === undefined) {
		return null;
	}

	const normalizedToolName = normalizeToolName(toolName);

	if (normalizedToolName === "readfiles") {
		const readFileSummaries = extractReadFileSummaries(input);
		return readFileSummaries.length > 0 ? formatArrayList(readFileSummaries) : null;
	}

	if (isRecord(input)) {
		const record = input;

		switch (normalizedToolName) {
			case "runcommands": {
				if (Array.isArray(record.commands)) {
					return formatArraySummary(record.commands);
				}
				break;
			}
			case "searchcodebase": {
				if (Array.isArray(record.queries)) {
					return formatArraySummary(record.queries);
				}
				break;
			}
			case "editor": {
				const path = record.path;
				const command = record.command;
				if (typeof path === "string") {
					return typeof command === "string" ? `${command} ${path}` : path;
				}
				break;
			}
			case "fetchwebcontent": {
				if (Array.isArray(record.requests) && record.requests.length > 0) {
					const first = record.requests[0];
					if (typeof first === "object" && first !== null && "url" in first) {
						const url = String((first as Record<string, unknown>).url);
						return record.requests.length > 1 ? `${url} (+${record.requests.length - 1} more)` : url;
					}
				}
				break;
			}
			case "skills": {
				if (typeof record.skill === "string") {
					return record.skill;
				}
				break;
			}
			case "askquestion": {
				if (typeof record.question === "string") {
					return record.question.split("\n")[0] ?? null;
				}
				break;
			}
		}

		for (const value of Object.values(record)) {
			if (typeof value === "string" && value.trim().length > 0) {
				return value.trim().split("\n")[0]?.slice(0, 120) ?? null;
			}
			if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") {
				return formatArraySummary(value);
			}
		}
	}

	if (typeof input === "string") {
		return summarizeStringInput(input);
	}

	return null;
}

export function getClineToolCallDisplay(toolName: string | null | undefined, input: unknown): ClineToolCallDisplay {
	const normalizedToolName = normalizeDisplayToolName(toolName);
	const parsedInput = parseToolInput(input);

	return {
		toolName: normalizedToolName,
		inputSummary: summarizeParsedToolInput(normalizedToolName, parsedInput),
	};
}

export function formatClineToolCallLabel(
	toolName: string | null | undefined,
	inputSummary: string | null | undefined,
): string {
	const normalizedToolName = normalizeDisplayToolName(toolName);
	const normalizedInputSummary = typeof inputSummary === "string" ? inputSummary.trim() : "";
	return normalizedInputSummary ? `${normalizedToolName}(${normalizedInputSummary})` : normalizedToolName;
}
