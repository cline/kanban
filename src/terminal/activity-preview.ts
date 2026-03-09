import type { RuntimeAgentId } from "../core/api-contract.js";
import { stripAnsi } from "./output-utils.js";

const MAX_PREVIEW_LINES = 5;

type TerminalParserMode = "text" | "escape" | "csi" | "osc" | "osc_escape" | "dcs" | "dcs_escape";

function createBlankLine(cols: number): string[] {
	return Array.from({ length: cols }, () => " ");
}

function clamp(value: number, min: number, max: number): number {
	if (value < min) {
		return min;
	}
	if (value > max) {
		return max;
	}
	return value;
}

class TerminalScreen {
	private readonly grid: string[][];
	private cursorRow = 0;
	private cursorCol = 0;
	private savedCursorRow = 0;
	private savedCursorCol = 0;

	constructor(
		private readonly cols: number,
		private readonly rows: number,
	) {
		this.grid = Array.from({ length: rows }, () => createBlankLine(cols));
	}

	renderLines(): string[] {
		return this.grid.map((row) => row.join("").replace(/\s+$/u, ""));
	}

	putChar(char: string): void {
		if (char === "\n") {
			this.newLine();
			return;
		}
		if (char === "\r") {
			this.cursorCol = 0;
			return;
		}
		if (char === "\b") {
			this.cursorCol = Math.max(0, this.cursorCol - 1);
			return;
		}
		if (char === "\t") {
			const nextStop = Math.floor(this.cursorCol / 8) * 8 + 8;
			while (this.cursorCol < nextStop) {
				this.putChar(" ");
			}
			return;
		}
		const code = char.charCodeAt(0);
		if (code < 32 || code === 127) {
			return;
		}
		if (this.cursorCol >= this.cols) {
			this.newLine();
			this.cursorCol = 0;
		}
		const row = this.grid[this.cursorRow];
		if (!row) {
			return;
		}
		row[this.cursorCol] = char;
		this.cursorCol += 1;
	}

	applyCsi(sequence: string, finalChar: string): void {
		const normalized = sequence.replaceAll(/[?>]/gu, "");
		const rawParts = normalized.length === 0 ? [] : normalized.split(";");
		const numbers = rawParts.map((part) => {
			const parsed = Number.parseInt(part, 10);
			return Number.isFinite(parsed) ? parsed : Number.NaN;
		});
		const get = (index: number, defaultValue: number) => {
			const value = numbers[index];
			if (!Number.isFinite(value) || value <= 0) {
				return defaultValue;
			}
			return value;
		};
		const getZeroAllowed = (index: number, defaultValue: number) => {
			const value = numbers[index];
			if (!Number.isFinite(value)) {
				return defaultValue;
			}
			return Math.max(0, value);
		};

		switch (finalChar) {
			case "A": {
				this.cursorRow = clamp(this.cursorRow - get(0, 1), 0, this.rows - 1);
				return;
			}
			case "B": {
				this.cursorRow = clamp(this.cursorRow + get(0, 1), 0, this.rows - 1);
				return;
			}
			case "C": {
				this.cursorCol = clamp(this.cursorCol + get(0, 1), 0, this.cols - 1);
				return;
			}
			case "D": {
				this.cursorCol = clamp(this.cursorCol - get(0, 1), 0, this.cols - 1);
				return;
			}
			case "E": {
				this.cursorRow = clamp(this.cursorRow + get(0, 1), 0, this.rows - 1);
				this.cursorCol = 0;
				return;
			}
			case "F": {
				this.cursorRow = clamp(this.cursorRow - get(0, 1), 0, this.rows - 1);
				this.cursorCol = 0;
				return;
			}
			case "G": {
				this.cursorCol = clamp(get(0, 1) - 1, 0, this.cols - 1);
				return;
			}
			case "d": {
				this.cursorRow = clamp(get(0, 1) - 1, 0, this.rows - 1);
				return;
			}
			case "H":
			case "f": {
				this.cursorRow = clamp(get(0, 1) - 1, 0, this.rows - 1);
				this.cursorCol = clamp(get(1, 1) - 1, 0, this.cols - 1);
				return;
			}
			case "J": {
				const mode = getZeroAllowed(0, 0);
				if (mode === 2) {
					for (let row = 0; row < this.rows; row += 1) {
						this.grid[row] = createBlankLine(this.cols);
					}
					return;
				}
				if (mode === 0) {
					for (let col = this.cursorCol; col < this.cols; col += 1) {
						this.grid[this.cursorRow][col] = " ";
					}
					for (let row = this.cursorRow + 1; row < this.rows; row += 1) {
						this.grid[row] = createBlankLine(this.cols);
					}
					return;
				}
				if (mode === 1) {
					for (let col = 0; col <= this.cursorCol; col += 1) {
						this.grid[this.cursorRow][col] = " ";
					}
					for (let row = 0; row < this.cursorRow; row += 1) {
						this.grid[row] = createBlankLine(this.cols);
					}
				}
				return;
			}
			case "K": {
				const mode = getZeroAllowed(0, 0);
				if (mode === 2) {
					this.grid[this.cursorRow] = createBlankLine(this.cols);
					return;
				}
				if (mode === 1) {
					for (let col = 0; col <= this.cursorCol; col += 1) {
						this.grid[this.cursorRow][col] = " ";
					}
					return;
				}
				for (let col = this.cursorCol; col < this.cols; col += 1) {
					this.grid[this.cursorRow][col] = " ";
				}
				return;
			}
			case "P": {
				const count = Math.max(1, getZeroAllowed(0, 1));
				const row = this.grid[this.cursorRow];
				for (let col = this.cursorCol; col < this.cols; col += 1) {
					const shifted = col + count;
					row[col] = shifted < this.cols ? row[shifted] : " ";
				}
				return;
			}
			case "X": {
				const count = Math.max(1, getZeroAllowed(0, 1));
				const row = this.grid[this.cursorRow];
				const end = Math.min(this.cols, this.cursorCol + count);
				for (let col = this.cursorCol; col < end; col += 1) {
					row[col] = " ";
				}
				return;
			}
			case "@": {
				const count = Math.max(1, getZeroAllowed(0, 1));
				const row = this.grid[this.cursorRow];
				for (let col = this.cols - 1; col >= this.cursorCol; col -= 1) {
					const source = col - count;
					row[col] = source >= this.cursorCol ? row[source] : " ";
				}
				return;
			}
			case "s": {
				this.savedCursorRow = this.cursorRow;
				this.savedCursorCol = this.cursorCol;
				return;
			}
			case "u": {
				this.cursorRow = clamp(this.savedCursorRow, 0, this.rows - 1);
				this.cursorCol = clamp(this.savedCursorCol, 0, this.cols - 1);
				return;
			}
			default:
				return;
		}
	}

	newLine(): void {
		this.cursorRow += 1;
		if (this.cursorRow < this.rows) {
			return;
		}
		this.scrollUp(1);
		this.cursorRow = this.rows - 1;
	}

	saveCursor(): void {
		this.savedCursorRow = this.cursorRow;
		this.savedCursorCol = this.cursorCol;
	}

	restoreCursor(): void {
		this.cursorRow = clamp(this.savedCursorRow, 0, this.rows - 1);
		this.cursorCol = clamp(this.savedCursorCol, 0, this.cols - 1);
	}

	private scrollUp(lines: number): void {
		for (let index = 0; index < lines; index += 1) {
			this.grid.shift();
			this.grid.push(createBlankLine(this.cols));
		}
	}
}

class TerminalOutputParser {
	private screen: TerminalScreen;
	private mode: TerminalParserMode = "text";
	private sequence = "";

	constructor(
		private cols: number,
		private rows: number,
	) {
		this.screen = new TerminalScreen(cols, rows);
	}

	append(buffer: string): void {
		for (const char of buffer) {
			if (this.mode === "text") {
				if (char === "\u001b") {
					this.mode = "escape";
					continue;
				}
				this.screen.putChar(char);
				continue;
			}

			if (this.mode === "escape") {
				if (char === "[") {
					this.mode = "csi";
					this.sequence = "";
					continue;
				}
				if (char === "]") {
					this.mode = "osc";
					continue;
				}
				if (char === "P") {
					this.mode = "dcs";
					continue;
				}
				if (char === "7") {
					this.screen.saveCursor();
				} else if (char === "8") {
					this.screen.restoreCursor();
				} else if (char === "D") {
					this.screen.newLine();
				} else if (char === "E") {
					this.screen.newLine();
					this.screen.putChar("\r");
				}
				this.mode = "text";
				continue;
			}

			if (this.mode === "csi") {
				const code = char.charCodeAt(0);
				if (code >= 64 && code <= 126) {
					this.screen.applyCsi(this.sequence, char);
					this.mode = "text";
				} else {
					this.sequence += char;
				}
				continue;
			}

			if (this.mode === "osc") {
				if (char === "\u0007") {
					this.mode = "text";
				} else if (char === "\u001b") {
					this.mode = "osc_escape";
				}
				continue;
			}

			if (this.mode === "osc_escape") {
				this.mode = char === "\\" ? "text" : "osc";
				continue;
			}

			if (this.mode === "dcs") {
				if (char === "\u0007") {
					this.mode = "text";
				} else if (char === "\u001b") {
					this.mode = "dcs_escape";
				}
				continue;
			}

			if (this.mode === "dcs_escape") {
				this.mode = char === "\\" ? "text" : "dcs";
			}
		}
	}

	renderLines(): string[] {
		return this.screen.renderLines();
	}

	reset(cols = this.cols, rows = this.rows): void {
		this.cols = cols;
		this.rows = rows;
		this.screen = new TerminalScreen(cols, rows);
		this.mode = "text";
		this.sequence = "";
	}
}

function isMostlyBoxDrawing(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed.length === 0) {
		return false;
	}
	let boxChars = 0;
	for (const char of trimmed) {
		if ("─━═│┃╭╮╰╯┌┐└┘▀▄█▁▂▃▅▆▇╹╺╻╸".includes(char)) {
			boxChars += 1;
		}
	}
	return boxChars / trimmed.length >= 0.7;
}

function normalizeVisibleLine(line: string): string {
	return line.replaceAll("\u0000", "").replace(/\s+/gu, " ").trim();
}

function findCutoffFromMarkers(lines: string[], markers: RegExp[]): number {
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index] ?? "";
		for (const marker of markers) {
			if (marker.test(line)) {
				return index;
			}
		}
	}
	return lines.length;
}

function isClaudeComposerBorder(line: string): boolean {
	return /^[\s─━═↯▪•·]+$/u.test(stripAnsi(line));
}

function resolveAgentCutoff(agentId: RuntimeAgentId | null, lines: string[]): number {
	if (agentId === "codex") {
		return findCutoffFromMarkers(lines, [/^\s*[›>]\s/iu, /\bcontext left\b/iu, /\b\/model\b/iu]);
	}
	if (agentId === "claude") {
		const promptIndex = findCutoffFromMarkers(lines, [/^\s*❯(?:\s|$)/iu]);
		if (promptIndex < lines.length) {
			for (let index = promptIndex; index >= 0; index -= 1) {
				if (isClaudeComposerBorder(lines[index] ?? "")) {
					return index;
				}
			}
			return promptIndex;
		}
		return findCutoffFromMarkers(lines, [/press ctrl-c again to exit/iu, /\b\/fast\b/iu]);
	}
	if (agentId === "gemini") {
		return findCutoffFromMarkers(lines, [
			/\btype your message\b/iu,
			/\bfor shortcuts\b/iu,
			/\bshift\+tab to accept edits\b/iu,
			/\bdo you want to connect cursor to gemini cli\b/iu,
		]);
	}
	if (agentId === "opencode") {
		const askAnythingIndex = findCutoffFromMarkers(lines, [/\bask anything\b/iu]);
		if (askAnythingIndex < lines.length) {
			return askAnythingIndex;
		}
		return findCutoffFromMarkers(lines, [/\bctrl\+t variants\b/iu, /\btab agents\b/iu, /\bctrl\+p commands\b/iu]);
	}
	if (agentId === "cline") {
		const questionIndex = findCutoffFromMarkers(lines, [/\bwhat can i do for you\b/iu]);
		if (questionIndex < lines.length) {
			return questionIndex;
		}
		return findCutoffFromMarkers(lines, [/\/ for commands · @ for files/iu, /\bauto-approve all disabled\b/iu]);
	}
	return findCutoffFromMarkers(lines, [/^\s*[›❯>]\s/iu, /\btype your message\b/iu, /\bask anything\b/iu]);
}

function isNoiseLine(line: string): boolean {
	if (line.length === 0) {
		return true;
	}
	if (isMostlyBoxDrawing(line)) {
		return true;
	}
	if (/^(?:[•●○⠋⧉▁▂▃▄▅▆▇█\s])+$/u.test(line)) {
		return true;
	}
	if (
		/(?:\bctrl\+|\bfor commands\b|\bfor shortcuts\b|\bcontext left\b|\bauto-approve\b|\bpress ctrl-c again to exit\b|\bchecking for updates\b|\bwaiting for auth\b|\binitializing\b|\bclaude code\b|\bopenai codex\b|\bapi usage billing\b|\bask anything\b|\bwhat can i do for you\b)/iu.test(
			line,
		)
	) {
		return true;
	}
	if (/^\s*[❯›>](?:\s|$)/u.test(line)) {
		return true;
	}
	if (/^(?:kanban|\/model|\d+\s+GEMINI\.md file)\b/iu.test(line)) {
		return true;
	}
	return false;
}

function extractActivityPreviewFromRendered(rendered: string[], agentId: RuntimeAgentId | null): string | null {
	const cutoff = resolveAgentCutoff(agentId, rendered);
	const candidateLines: string[] = [];
	for (let index = 0; index < cutoff; index += 1) {
		const normalized = normalizeVisibleLine(stripAnsi(rendered[index] ?? ""));
		if (normalized.length === 0) {
			continue;
		}
		if (isNoiseLine(normalized)) {
			continue;
		}
		candidateLines.push(normalized);
	}
	if (candidateLines.length === 0) {
		return null;
	}

	const recent: string[] = [];
	for (let index = candidateLines.length - 1; index >= 0; index -= 1) {
		const line = candidateLines[index];
		if (!line) {
			continue;
		}
		if (recent[recent.length - 1] === line) {
			continue;
		}
		recent.push(line);
		if (recent.length >= MAX_PREVIEW_LINES) {
			break;
		}
	}
	recent.reverse();
	return recent.join("\n");
}

export interface ActivityPreviewTracker {
	append(chunk: string): void;
	resize(cols: number, rows: number): void;
	extract(agentId: RuntimeAgentId | null): string | null;
}

class IncrementalActivityPreviewTracker implements ActivityPreviewTracker {
	private cols: number;
	private rows: number;
	private parser: TerminalOutputParser;

	constructor(cols: number, rows: number) {
		this.cols = cols;
		this.rows = rows;
		this.parser = new TerminalOutputParser(this.cols, this.rows);
	}

	append(chunk: string): void {
		if (chunk.length === 0) {
			return;
		}
		this.parser.append(chunk);
	}

	resize(cols: number, rows: number): void {
		if (cols === this.cols && rows === this.rows) {
			return;
		}
		this.cols = cols;
		this.rows = rows;
		this.parser.reset(cols, rows);
	}

	extract(agentId: RuntimeAgentId | null): string | null {
		return extractActivityPreviewFromRendered(this.parser.renderLines(), agentId);
	}
}

export function createActivityPreviewTracker(cols: number, rows: number): ActivityPreviewTracker {
	return new IncrementalActivityPreviewTracker(cols, rows);
}
