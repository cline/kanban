export interface ParsedToolMessageContent {
	toolName: string;
	input: string | null;
	output: string | null;
	error: string | null;
	durationMs: number | null;
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
