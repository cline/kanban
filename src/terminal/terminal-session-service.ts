import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import type { TerminalRestoreSnapshot } from "./terminal-state-mirror";

export interface TerminalSessionListener {
	onOutput?: (chunk: Buffer) => void;
	onState?: (summary: RuntimeTaskSessionSummary) => void;
	onExit?: (code: number | null) => void;
}

export interface TerminalSessionService {
	attach(taskId: string, listener: TerminalSessionListener): (() => void) | null;
	getRestoreSnapshot(taskId: string): Promise<TerminalRestoreSnapshot | null>;
	recoverStaleSession(taskId: string): RuntimeTaskSessionSummary | null;
	writeInput(taskId: string, data: Buffer): RuntimeTaskSessionSummary | null;
	resize(taskId: string, cols: number, rows: number, pixelWidth?: number, pixelHeight?: number): boolean;
	pauseOutput(taskId: string): boolean;
	resumeOutput(taskId: string): boolean;
	stopTaskSession(taskId: string): RuntimeTaskSessionSummary | null;
}
