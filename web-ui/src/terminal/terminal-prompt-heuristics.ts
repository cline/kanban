const ESC = "\\u001b";
const BEL = "\\u0007";

const CSI_ESCAPE_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");
const OSC_ESCAPE_PATTERN = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g");
const SINGLE_ESCAPE_PATTERN = new RegExp(`${ESC}[@-Z\\\\-_]`, "g");
const INTERRUPT_ACK_PATTERN = /(?:\^C|keyboardinterrupt|terminated|canceled|cancelled|aborted|interrupt)/i;
const POWER_SHELL_PROMPT_PATTERN = /(?:^|\n)PS [^\n\r>]{0,200}> $/;
const CMD_PROMPT_PATTERN = /(?:^|\n)[A-Za-z]:\\[^\n\r]{0,200}> $/;
const POSIX_PROMPT_PATTERN = /(?:^|\n)[^\n\r]{0,200}[%#$] $/;
const GLYPH_PROMPT_PATTERN = /(?:^|\n)[^\n\r]{0,200}[❯➜λ] $/;
const GENERIC_PATH_PROMPT_PATTERN = /(?:^|\n)(?:~|\.?\.?(?:[\\/][^\n\r ]+)*) ?> $/;
const MAX_HEURISTIC_BUFFER_CHARS = 4000;

function stripAnsiSequences(text: string): string {
	return text.replace(OSC_ESCAPE_PATTERN, "").replace(CSI_ESCAPE_PATTERN, "").replace(SINGLE_ESCAPE_PATTERN, "");
}

export function sanitizeTerminalHeuristicText(text: string): string {
	const withoutAnsi = stripAnsiSequences(text);
	return withoutAnsi.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function appendTerminalHeuristicText(buffer: string, chunk: string): string {
	const combined = `${buffer}${sanitizeTerminalHeuristicText(chunk)}`;
	return combined.length > MAX_HEURISTIC_BUFFER_CHARS ? combined.slice(-MAX_HEURISTIC_BUFFER_CHARS) : combined;
}

export function hasInterruptAcknowledgement(text: string): boolean {
	return INTERRUPT_ACK_PATTERN.test(text);
}

export function hasLikelyShellPrompt(text: string): boolean {
	return (
		POWER_SHELL_PROMPT_PATTERN.test(text) ||
		CMD_PROMPT_PATTERN.test(text) ||
		POSIX_PROMPT_PATTERN.test(text) ||
		GLYPH_PROMPT_PATTERN.test(text) ||
		GENERIC_PATH_PROMPT_PATTERN.test(text)
	);
}
