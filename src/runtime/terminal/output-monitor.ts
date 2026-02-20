const ATTENTION_PATTERNS: RegExp[] = [
	/\ballow\b/i,
	/\bdeny\b/i,
	/\bapprove\b/i,
	/\bpermission\b/i,
	/\bdo you want\b/i,
	/\bwaiting for input\b/i,
	/\bpress enter\b/i,
	/\benter to continue\b/i,
	/\by\/n\b/i,
	/\bchoose an option\b/i,
	/\?\s*$/,
];

export function stripAnsi(input: string): string {
	let output = "";
	for (let index = 0; index < input.length; index += 1) {
		const code = input.charCodeAt(index);
		if (code === 27 && input[index + 1] === "[") {
			index += 2;
			while (index < input.length) {
				const nextCode = input.charCodeAt(index);
				if (nextCode >= 64 && nextCode <= 126) {
					break;
				}
				index += 1;
			}
			continue;
		}
		output += input[index] ?? "";
	}
	return output;
}

function normalizeLine(line: string): string {
	return stripAnsi(line).replaceAll("\u0000", "").replaceAll("\r", "").trim();
}

export function extractLastActivityLine(buffer: string): string | null {
	const lines = buffer.split("\n");
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = normalizeLine(lines[index] ?? "");
		if (line.length === 0) {
			continue;
		}
		if (line.length > 220) {
			return `${line.slice(0, 217)}...`;
		}
		return line;
	}
	return null;
}

export function detectNeedsAttention(buffer: string): boolean {
	const line = extractLastActivityLine(buffer);
	if (!line) {
		return false;
	}
	for (const pattern of ATTENTION_PATTERNS) {
		if (pattern.test(line)) {
			return true;
		}
	}
	return false;
}
