export interface SendTerminalInputOptions {
	appendNewline?: boolean;
	/**
	 * - `"type"`: Send as raw keystrokes.
	 * - `"paste"`: Send wrapped in a bracketed paste sequence (no submit).
	 * - `"paste-submit"`: Send wrapped in a bracketed paste sequence followed
	 *    by `\r` in a single atomic write, so programs that ignore a bare `\r`
	 *    after a paste (e.g. Copilot CLI) still submit.
	 */
	mode?: "type" | "paste" | "paste-submit";
	preferTerminal?: boolean;
}
