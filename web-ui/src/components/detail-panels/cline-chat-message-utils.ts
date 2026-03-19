import { getClineToolCallDisplay } from "@runtime-cline-tool-call-display";

export interface ParsedToolMessageContent {
	toolName: string;
	input: string | null;
	output: string | null;
	error: string | null;
	durationMs: number | null;
}

/**
 * Extracts a short, human-readable summary from the tool's input parameters.
 * Uses tool-specific logic for known Cline SDK tools, then falls back to generic extraction.
 */
export function getToolSummary(toolName: string, input: string | null): string | null {
	return getClineToolCallDisplay(toolName, input).inputSummary;
}

export interface ToolOutputResult {
	query: string;
	content: string;
	error: string | null;
	success: boolean;
}

export interface ParsedToolOutput {
	results: ToolOutputResult[];
}

function isToolOperationResult(
	value: unknown,
): value is { query: string; result: string; success: boolean; error?: string } {
	if (typeof value !== "object" || value === null) return false;
	if (!("success" in value) || !("result" in value)) return false;
	const obj = value as Record<string, unknown>;
	return typeof obj.result === "string" && typeof obj.success === "boolean";
}

function toToolOutputResult(item: {
	query: string;
	result: string;
	success: boolean;
	error?: string;
}): ToolOutputResult {
	return {
		query: String(item.query ?? ""),
		content: item.result,
		error: typeof item.error === "string" ? item.error : null,
		success: item.success,
	};
}

/**
 * Parses raw tool output JSON into structured results.
 * Handles both single ToolOperationResult and ToolOperationResult[] (batch tools).
 */
export function parseToolOutput(output: string): ParsedToolOutput | null {
	try {
		const parsed: unknown = JSON.parse(output);

		if (Array.isArray(parsed) && parsed.length > 0 && isToolOperationResult(parsed[0])) {
			return { results: parsed.filter(isToolOperationResult).map(toToolOutputResult) };
		}

		if (isToolOperationResult(parsed)) {
			return { results: [toToolOutputResult(parsed)] };
		}
	} catch {
		return null;
	}

	return null;
}

function normalizeSectionValue(lines: string[]): string | null {
	const value = lines.join("\n").trim();
	return value.length > 0 ? value : null;
}

export function parseToolMessageContent(content: string): ParsedToolMessageContent {
	const lines = content.split("\n");
	let toolName = "unknown";
	let durationMs: number | null = null;

	const sections = {
		input: [] as string[],
		output: [] as string[],
		error: [] as string[],
	};

	type ActiveSection = keyof typeof sections | null;
	let activeSection: ActiveSection = null;

	for (const line of lines) {
		if (line.startsWith("Tool:")) {
			toolName = line.slice("Tool:".length).trim() || "unknown";
			activeSection = null;
			continue;
		}
		if (line === "Input:") {
			activeSection = "input";
			continue;
		}
		if (line === "Output:") {
			activeSection = "output";
			continue;
		}
		if (line === "Error:") {
			activeSection = "error";
			continue;
		}
		if (line.startsWith("Duration:")) {
			activeSection = null;
			const durationMatch = /Duration:\s*(\d+)ms/i.exec(line);
			if (durationMatch?.[1]) {
				durationMs = Number.parseInt(durationMatch[1], 10);
			}
			continue;
		}
		if (activeSection) {
			sections[activeSection].push(line);
		}
	}

	return {
		toolName,
		input: normalizeSectionValue(sections.input),
		output: normalizeSectionValue(sections.output),
		error: normalizeSectionValue(sections.error),
		durationMs,
	};
}
