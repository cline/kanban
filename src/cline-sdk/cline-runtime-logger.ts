import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ClineSdkBasicLogger as BasicLogger, resolveClineSdkDataDir } from "./sdk-runtime-boundary.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

const DEFAULT_LOG_NAME = "kanban";
const DEFAULT_LOG_PATH = join(resolveClineSdkDataDir(), "logs", `${DEFAULT_LOG_NAME}.log`);

function normalizeLogLevel(value: string | undefined): LogLevel {
	const normalized = value?.trim().toLowerCase();
	if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
		return normalized;
	}
	return "info";
}

function normalizeLogPath(): string {
	const configured = process.env.CLINE_LOG_PATH?.trim();
	return configured && configured.length > 0 ? configured : DEFAULT_LOG_PATH;
}

function isLoggingEnabled(): boolean {
	const configured = process.env.CLINE_LOG_ENABLED?.trim().toLowerCase();
	if (configured === undefined) {
		return false;
	}
	return configured === "1" || configured === "true" || configured === "yes" || configured === "on";
}

function writeLogLine(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
	if (!isLoggingEnabled()) {
		return;
	}
	const line = JSON.stringify({
		ts: new Date().toISOString(),
		level,
		message,
		...(metadata ? { metadata } : {}),
	});
	try {
		const destination = normalizeLogPath();
		mkdirSync(dirname(destination), { recursive: true });
		appendFileSync(destination, `${line}\n`, "utf8");
	} catch {
		// Best-effort logging only.
	}
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function logToConsole(_level: LogLevel, _message: string, _metadata?: Record<string, unknown>): void {
	// Console logging intentionally disabled; re-enable by routing to console.debug/info/warn/error.
}

export function createKanbanClineLogger(bindings?: Record<string, unknown>): BasicLogger {
	const minLevel = normalizeLogLevel(process.env.CLINE_LOG_LEVEL);
	const shouldLog = (level: LogLevel) => LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel];
	const emit = (level: LogLevel, message: string, metadata?: Record<string, unknown>) => {
		if (!shouldLog(level)) {
			return;
		}
		const mergedMetadata =
			bindings || metadata
				? {
						...(bindings ?? {}),
						...(metadata ?? {}),
					}
				: undefined;
		writeLogLine(level, message, mergedMetadata);
		logToConsole(level, message, mergedMetadata);
	};

	return {
		debug: (message: string, metadata: Record<string, unknown> | undefined) => emit("debug", message, metadata),
		info: (message: string, metadata: Record<string, unknown> | undefined) => emit("info", message, metadata),
		warn: (message: string, metadata: Record<string, unknown> | undefined) => emit("warn", message, metadata),
		error: (message: string, metadata: Record<string, unknown> | undefined) => emit("error", message, metadata),
	};
}
