export interface ClineToolCallDisplay {
	toolName: string;
	inputSummary: string | null;
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
		if (typeof input === "string") {
			return input.trim() || null;
		}
		if (Array.isArray(input)) {
			return formatArrayList(input);
		}
	}

	if (typeof input === "object" && input !== null && !Array.isArray(input)) {
		const record = input as Record<string, unknown>;

		switch (normalizedToolName) {
			case "runcommands": {
				if (Array.isArray(record.commands)) {
					return formatArraySummary(record.commands);
				}
				break;
			}
			case "readfiles": {
				if (Array.isArray(record.file_paths)) {
					return formatArrayList(record.file_paths);
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

export function formatClineToolCallLabel(toolName: string | null | undefined, inputSummary: string | null | undefined): string {
	const normalizedToolName = normalizeDisplayToolName(toolName);
	const normalizedInputSummary = typeof inputSummary === "string" ? inputSummary.trim() : "";
	return normalizedInputSummary ? `${normalizedToolName}(${normalizedInputSummary})` : normalizedToolName;
}
