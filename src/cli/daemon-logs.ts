import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const LOG_DIRECTORY = join(homedir(), ".cline", "kanban", "logs");

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

export function getDaemonLogPath(date = new Date()): string {
	const filename = `daemon-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.log`;
	return join(LOG_DIRECTORY, filename);
}

export async function ensureDaemonLogDirectory(): Promise<void> {
	await mkdir(LOG_DIRECTORY, { recursive: true });
}
