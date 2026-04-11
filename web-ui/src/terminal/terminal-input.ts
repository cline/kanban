export interface SendTerminalInputOptions {
	appendNewline?: boolean;
	mode?: "type" | "paste";
	preferTerminal?: boolean;
}

export type SendTaskSessionInputFn = (
	taskId: string,
	text: string,
	options?: SendTerminalInputOptions,
) => Promise<{ ok: boolean; message?: string }>;

const FOCUS_IN = "\x1b[I";
const FOCUS_DELAY_MS = 300;

/**
 * Send text to a TUI agent that ignores input when the terminal is
 * unfocused.  Prepends a focus-in escape sequence and sends Enter as
 * a separate write after a short delay so the TUI processes the text
 * before the submission keystroke.
 */
export async function sendTuiInputWithSubmit(
	sendInput: SendTaskSessionInputFn,
	taskId: string,
	text: string,
): Promise<{ ok: boolean; message?: string }> {
	await sendInput(taskId, FOCUS_IN + text, { appendNewline: false, preferTerminal: false });
	await new Promise<void>((resolve) => {
		setTimeout(resolve, FOCUS_DELAY_MS);
	});
	return sendInput(taskId, "\r", { appendNewline: false, preferTerminal: false });
}
