import type { Dirent, Stats } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { RuntimeHookEvent, RuntimeTaskHookActivity } from "../../core/api-contract";

const CODEX_LOG_POLL_INTERVAL_MS = 200;
const CODEX_ROLLOUT_POLL_INTERVAL_MS = 1000;
const MAX_CODEX_ROLLOUT_FILES_TO_SCAN = 250;
const CODEX_ROLLOUT_FILE_FRESH_WINDOW_MS = 10 * 60 * 1000;
const CODEX_ROLLOUT_MATCH_SCAN_BYTES = 256 * 1024;
const CODEX_ROLLOUT_TAIL_SCAN_BYTES = 2 * 1024 * 1024;
const CODEX_ROLLOUT_INITIAL_BACKLOG_BYTES = 256 * 1024;
const CODEX_USER_INPUT_TOOL_NAMES = new Set(["AskUserQuestion", "ask_user_question", "request_user_input"]);

interface CodexWatcherState {
	lastTurnId: string;
	lastApprovalId: string;
	lastExecCallId: string;
	lastActivityFingerprint: string;
	approvalFallbackSeq: number;
	offset: number;
	remainder: string;
	currentSessionScope: "unknown" | "root" | "descendant";
}

interface CodexEventPayload {
	type?: unknown;
	turn_id?: unknown;
	id?: unknown;
	approval_id?: unknown;
	call_id?: unknown;
	last_agent_message?: unknown;
	message?: unknown;
	command?: unknown;
	item?: unknown;
}

interface CodexSessionLogLine {
	dir?: unknown;
	kind?: unknown;
	msg?: unknown;
	payload?: unknown;
	turn_id?: unknown;
	id?: unknown;
	approval_id?: unknown;
	call_id?: unknown;
}

export interface CodexMappedHookEvent {
	event: RuntimeHookEvent;
	metadata?: Partial<RuntimeTaskHookActivity>;
}

export type CodexSessionWatcherNotify = (mapped: CodexMappedHookEvent) => void;

export interface CodexSessionWatcherOptions {
	cwd?: string;
	sessionsRoot?: string;
	rolloutPollIntervalMs?: number;
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}
	return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function readStringField(record: Record<string, unknown>, key: string): string | null {
	const value = record[key];
	if (typeof value !== "string") {
		return null;
	}
	const normalized = normalizeWhitespace(value);
	return normalized.length > 0 ? normalized : null;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
	try {
		return asRecord(JSON.parse(value));
	} catch {
		return null;
	}
}

function isCodexUserInputToolName(name: string | null): boolean {
	if (!name) {
		return false;
	}
	return CODEX_USER_INPUT_TOOL_NAMES.has(name);
}

function normalizePathForComparison(path: string): string {
	return path.replaceAll("\\", "/");
}

async function readFilePrefix(filePath: string, byteLength: number): Promise<string> {
	if (byteLength <= 0) {
		return "";
	}
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		handle = await open(filePath, "r");
		const buffer = Buffer.alloc(byteLength);
		const readResult = await handle.read(buffer, 0, byteLength, 0);
		return buffer.subarray(0, readResult.bytesRead).toString("utf8");
	} finally {
		await handle?.close();
	}
}

async function readFileTail(filePath: string, fileSize: number, maxBytes: number): Promise<string> {
	if (fileSize <= 0 || maxBytes <= 0) {
		return "";
	}
	const byteLength = Math.min(fileSize, maxBytes);
	const start = Math.max(0, fileSize - byteLength);
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		handle = await open(filePath, "r");
		const buffer = Buffer.alloc(byteLength);
		const readResult = await handle.read(buffer, 0, byteLength, start);
		return buffer.subarray(0, readResult.bytesRead).toString("utf8");
	} finally {
		await handle?.close();
	}
}

async function listCodexRolloutFiles(rootPath: string): Promise<string[]> {
	const stack = [rootPath];
	const files: string[] = [];

	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			continue;
		}

		let entries: Dirent[];
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries) {
			const entryPath = join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(entryPath);
				continue;
			}
			if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
				files.push(entryPath);
			}
		}
	}

	files.sort((a, b) => b.localeCompare(a));
	return files;
}

function extractFinalMessageFromRolloutLine(lineRecord: Record<string, unknown>): string | null {
	const lineType = readStringField(lineRecord, "type");
	if (lineType === "event_msg") {
		const payload = asRecord(lineRecord.payload);
		const payloadType = payload ? readStringField(payload, "type") : null;
		if (payloadType === "task_complete") {
			const lastAgentMessage = payload ? readStringField(payload, "last_agent_message") : null;
			if (lastAgentMessage) {
				return lastAgentMessage;
			}
		}
		if (payloadType === "agent_message") {
			const phase = payload ? readStringField(payload, "phase") : null;
			const message = payload ? readStringField(payload, "message") : null;
			if (phase === "final_answer" && message) {
				return message;
			}
		}
	}

	if (lineType === "response_item") {
		const payload = asRecord(lineRecord.payload);
		if (!payload) {
			return null;
		}
		const payloadType = readStringField(payload, "type");
		const role = readStringField(payload, "role");
		const phase = readStringField(payload, "phase");
		if (payloadType !== "message" || role !== "assistant" || phase !== "final_answer") {
			return null;
		}
		const content = payload.content;
		if (!Array.isArray(content)) {
			return null;
		}
		for (let index = content.length - 1; index >= 0; index -= 1) {
			const item = asRecord(content[index]);
			if (!item) {
				continue;
			}
			if (readStringField(item, "type") !== "output_text") {
				continue;
			}
			const text = readStringField(item, "text");
			if (text) {
				return text;
			}
		}
	}

	return null;
}

function extractRolloutCommandFromArgsString(argsRaw: string | null): string | null {
	if (!argsRaw) {
		return null;
	}
	const args = parseJsonObject(argsRaw);
	if (!args) {
		return null;
	}
	const command = readStringField(args, "cmd") ?? readStringField(args, "command") ?? readStringField(args, "query");
	return command || null;
}

function extractRolloutCommandFromPayload(payload: Record<string, unknown>): string | null {
	const parsedCommands = payload.parsed_cmd;
	if (Array.isArray(parsedCommands)) {
		for (const item of parsedCommands) {
			const parsedItem = asRecord(item);
			if (!parsedItem) {
				continue;
			}
			const parsedCommand = readStringField(parsedItem, "cmd");
			if (parsedCommand) {
				return parsedCommand;
			}
		}
	}

	const commandArray = payload.command;
	if (Array.isArray(commandArray)) {
		const commandParts = commandArray.filter((part): part is string => typeof part === "string");
		if (commandParts.length >= 3 && commandParts[1] === "-lc") {
			const shellCommand = normalizeWhitespace(commandParts[2] ?? "");
			if (shellCommand) {
				return shellCommand;
			}
		}
		const combined = normalizeWhitespace(commandParts.join(" "));
		if (combined) {
			return combined;
		}
	}

	const command =
		readStringField(payload, "cmd") ?? readStringField(payload, "command") ?? readStringField(payload, "query");
	return command || null;
}

export async function resolveCodexRolloutFinalMessageForCwd(
	cwd: string,
	sessionsRoot = join(homedir(), ".codex", "sessions"),
): Promise<string | null> {
	if (!cwd.trim()) {
		return null;
	}
	const normalizedCwd = normalizePathForComparison(cwd);
	const encodedCwd = JSON.stringify(normalizedCwd);
	const rolloutFiles = (await listCodexRolloutFiles(sessionsRoot)).slice(0, MAX_CODEX_ROLLOUT_FILES_TO_SCAN);

	for (const filePath of rolloutFiles) {
		let fileStat: Stats;
		try {
			fileStat = await stat(filePath);
		} catch {
			continue;
		}

		let prefix = "";
		try {
			prefix = await readFilePrefix(filePath, Math.min(fileStat.size, CODEX_ROLLOUT_MATCH_SCAN_BYTES));
		} catch {
			continue;
		}
		if (!prefix.includes(`"cwd":${encodedCwd}`)) {
			continue;
		}

		let scanText = "";
		try {
			scanText = await readFileTail(filePath, fileStat.size, CODEX_ROLLOUT_TAIL_SCAN_BYTES);
		} catch {
			continue;
		}
		const lines = scanText.split(/\r?\n/);
		for (let index = lines.length - 1; index >= 0; index -= 1) {
			const line = lines[index]?.trim();
			if (!line) {
				continue;
			}
			const parsedLine = parseJsonObject(line);
			if (!parsedLine) {
				continue;
			}
			const finalMessage = extractFinalMessageFromRolloutLine(parsedLine);
			if (finalMessage) {
				return finalMessage;
			}
		}
	}

	return null;
}

async function findCodexRolloutFileForCwd(
	cwd: string,
	sessionStartedAtMs: number,
	sessionsRoot: string,
): Promise<string | null> {
	if (!cwd.trim()) {
		return null;
	}
	const normalizedCwd = normalizePathForComparison(cwd);
	const encodedCwd = JSON.stringify(normalizedCwd);
	const rolloutFiles = (await listCodexRolloutFiles(sessionsRoot)).slice(0, MAX_CODEX_ROLLOUT_FILES_TO_SCAN);

	for (const filePath of rolloutFiles) {
		let fileStat: Stats;
		try {
			fileStat = await stat(filePath);
			if (fileStat.mtimeMs < sessionStartedAtMs - CODEX_ROLLOUT_FILE_FRESH_WINDOW_MS) {
				continue;
			}
		} catch {
			continue;
		}

		let prefix = "";
		try {
			prefix = await readFilePrefix(filePath, Math.min(fileStat.size, CODEX_ROLLOUT_MATCH_SCAN_BYTES));
		} catch {
			continue;
		}
		if (prefix.includes(`"cwd":${encodedCwd}`)) {
			return filePath;
		}
	}

	return null;
}

function mapCodexRolloutActivityLine(line: string): { mapped: CodexMappedHookEvent; fingerprint: string } | null {
	const parsedLine = parseJsonObject(line);
	if (!parsedLine) {
		return null;
	}
	const lineType = readStringField(parsedLine, "type");
	if (!lineType) {
		return null;
	}
	if (lineType === "event_msg") {
		const payload = asRecord(parsedLine.payload);
		if (!payload) {
			return null;
		}
		const payloadType = readStringField(payload, "type");
		if (!payloadType) {
			return null;
		}
		const normalizedType = payloadType.toLowerCase();
		if (normalizedType === "agent_message") {
			const phase = readStringField(payload, "phase");
			const message = readStringField(payload, "message");
			if (phase === "final_answer" && message) {
				return {
					fingerprint: `rollout:final_answer:${truncateText(message, 160)}`,
					mapped: {
						event: "to_review",
						metadata: {
							source: "codex",
							hookEventName: payloadType,
							activityText: `Final: ${message}`,
							finalMessage: message,
						},
					},
				};
			}
			if (phase === "commentary" && message) {
				return {
					fingerprint: `rollout:agent_message:${truncateText(message, 140)}`,
					mapped: {
						event: "activity",
						metadata: {
							source: "codex",
							hookEventName: payloadType,
							activityText: `Agent: ${message}`,
						},
					},
				};
			}
			return null;
		}
		if (normalizedType === "task_complete") {
			const finalMessage = readStringField(payload, "last_agent_message");
			return {
				fingerprint: `rollout:task_complete:${truncateText(finalMessage ?? "", 160)}`,
				mapped: {
					event: "to_review",
					metadata: {
						source: "codex",
						hookEventName: payloadType,
						activityText: finalMessage ? `Final: ${finalMessage}` : "Waiting for review",
						finalMessage: finalMessage ?? undefined,
					},
				},
			};
		}
		if (normalizedType === "exec_command_begin" || normalizedType === "exec_command_start") {
			const callId = readStringField(payload, "call_id") ?? "unknown";
			const command = extractRolloutCommandFromPayload(payload);
			return {
				fingerprint: `rollout:exec_begin:${callId}:${command ?? ""}`,
				mapped: {
					event: "activity",
					metadata: {
						source: "codex",
						hookEventName: payloadType,
						activityText: command ? `Running command: ${command}` : "Running command",
					},
				},
			};
		}
		if (normalizedType === "exec_command_end") {
			const callId = readStringField(payload, "call_id") ?? "unknown";
			const command = extractRolloutCommandFromPayload(payload);
			const status = (readStringField(payload, "status") ?? "completed").toLowerCase();
			const failed = status === "failed";
			return {
				fingerprint: `rollout:exec_end:${callId}:${status}:${command ?? ""}`,
				mapped: {
					event: "activity",
					metadata: {
						source: "codex",
						hookEventName: payloadType,
						activityText: failed
							? command
								? `Command failed: ${command}`
								: "Command failed"
							: command
								? `Command finished: ${command}`
								: "Command finished",
					},
				},
			};
		}
		return null;
	}
	if (lineType === "response_item") {
		const payload = asRecord(parsedLine.payload);
		if (!payload) {
			return null;
		}
		const payloadType = readStringField(payload, "type");
		if (payloadType === "function_call") {
			const name = readStringField(payload, "name") ?? "tool";
			const callId = readStringField(payload, "call_id") ?? "unknown";
			const command = extractRolloutCommandFromArgsString(readStringField(payload, "arguments"));
			const event: RuntimeHookEvent = isCodexUserInputToolName(name) ? "to_review" : "activity";
			const activityText = isCodexUserInputToolName(name)
				? "Waiting for input"
				: command
					? `Calling ${name}: ${command}`
					: `Calling ${name}`;
			return {
				fingerprint: `rollout:function_call:${callId}:${name}:${command ?? ""}`,
				mapped: {
					event,
					metadata: {
						source: "codex",
						hookEventName: payloadType,
						activityText,
					},
				},
			};
		}
	}
	return null;
}

function getString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function parseCodexSessionLogLine(line: string): CodexSessionLogLine | null {
	try {
		const parsed = JSON.parse(line) as CodexSessionLogLine;
		const dir = getString(parsed.dir);
		const kind = getString(parsed.kind);
		const hasStructuredMsg = Boolean(parsed.msg && typeof parsed.msg === "object" && !Array.isArray(parsed.msg));
		const payload = asRecord(parsed.payload);
		const payloadType = payload ? readStringField(payload, "type") : null;
		const isCodexEventLine =
			(kind === "codex_event" && (dir === "to_tui" || dir === "")) ||
			(kind === "op" &&
				(dir === "from_tui" || dir === "to_tui" || dir === "") &&
				typeof payloadType === "string" &&
				payloadType.length > 0) ||
			(kind === "" && hasStructuredMsg) ||
			(dir === "to_tui" && hasStructuredMsg);
		if (!isCodexEventLine) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

function parseCodexEventPayload(line: CodexSessionLogLine): CodexEventPayload | null {
	const payload = asRecord(line.payload);
	if (payload) {
		const payloadMsg = asRecord(payload.msg);
		if (payloadMsg) {
			return payloadMsg as CodexEventPayload;
		}
		if (typeof payload.type === "string") {
			return payload as CodexEventPayload;
		}
	}

	if (line.msg && typeof line.msg === "object" && !Array.isArray(line.msg)) {
		return line.msg as CodexEventPayload;
	}
	if (typeof line === "object" && line !== null && "type" in line) {
		return line as CodexEventPayload;
	}
	return null;
}

function parseJsonString(value: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(value) as unknown;
		return asRecord(parsed);
	} catch {
		return null;
	}
}

function pickFirstString(values: unknown[]): string {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) {
			return value;
		}
	}
	return "";
}

function extractJsonStringField(line: string, field: string): string {
	const pattern = new RegExp(`"${field}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`);
	const match = line.match(pattern);
	if (!match?.[1]) {
		return "";
	}
	try {
		return JSON.parse(`"${match[1]}"`) as string;
	} catch {
		return match[1];
	}
}

function extractCodexCommandSnippet(message: CodexEventPayload, line: string): string | null {
	const directCommand = pickFirstString([
		extractJsonStringField(line, "command"),
		extractJsonStringField(line, "cmd"),
		message.command,
	]);
	if (directCommand) {
		return directCommand;
	}

	if (Array.isArray(message.command)) {
		const commandText = message.command
			.filter((part): part is string => typeof part === "string")
			.join(" ")
			.trim();
		if (commandText) {
			return commandText;
		}
	}

	const item = asRecord(message.item);
	if (item?.type === "function_call") {
		const argsRaw = typeof item.arguments === "string" ? item.arguments : "";
		const args = argsRaw ? parseJsonString(argsRaw) : null;
		const cmd = args ? readStringField(args, "cmd") : null;
		if (cmd) {
			return cmd;
		}
	}

	return null;
}

function isCodexDescendantSession(message: unknown): boolean {
	const messageRecord = asRecord(message);
	const payload = messageRecord ? asRecord(messageRecord.payload) : null;
	const source = payload ? asRecord(payload.source) : null;
	const subagent = source ? asRecord(source.subagent) : null;
	const threadSpawn = subagent ? asRecord(subagent.thread_spawn) : null;
	return threadSpawn !== null;
}

export function createCodexWatcherState(): CodexWatcherState {
	return {
		lastTurnId: "",
		lastApprovalId: "",
		lastExecCallId: "",
		lastActivityFingerprint: "",
		approvalFallbackSeq: 0,
		offset: 0,
		remainder: "",
		currentSessionScope: "unknown",
	};
}

export function parseCodexEventLine(line: string, state: CodexWatcherState): CodexMappedHookEvent | null {
	const parsed = parseCodexSessionLogLine(line);
	if (!parsed) {
		return null;
	}
	const message = parseCodexEventPayload(parsed);
	if (!message) {
		return null;
	}
	const type = getString(message?.type);
	if (!type) {
		return null;
	}
	const normalizedType = type.toLowerCase();
	if (normalizedType === "session_meta") {
		state.currentSessionScope = isCodexDescendantSession(message) ? "descendant" : "root";
		return null;
	}
	if (state.currentSessionScope === "descendant") {
		if (normalizedType === "task_complete" || normalizedType === "turn_aborted") {
			state.currentSessionScope = "unknown";
		}
		return null;
	}
	const command = extractCodexCommandSnippet(message, line);
	const messageText = typeof message.message === "string" ? normalizeWhitespace(message.message) : "";
	const lastAgentMessage =
		typeof message.last_agent_message === "string" ? normalizeWhitespace(message.last_agent_message) : "";

	if (normalizedType === "task_started" || normalizedType === "turn_started" || normalizedType === "turn_begin") {
		const turnId = pickFirstString([
			extractJsonStringField(line, "turn_id"),
			message?.turn_id,
			parsed.turn_id,
			normalizedType,
		]);
		if (turnId !== state.lastTurnId) {
			state.lastTurnId = turnId;
			return {
				event: "to_in_progress",
				metadata: {
					source: "codex",
					activityText: command ? `Working on task: ${command}` : "Working on task",
					hookEventName: type,
				},
			};
		}
		return null;
	}

	if (normalizedType === "user_turn") {
		return {
			event: "to_in_progress",
			metadata: {
				source: "codex",
				activityText: "Resumed after user input",
				hookEventName: type,
			},
		};
	}

	if (normalizedType === "raw_response_item") {
		const item = asRecord(message.item);
		if (item?.type === "function_call") {
			const callId = readStringField(item, "call_id") ?? pickFirstString([message.call_id, parsed.call_id]);
			const name = readStringField(item, "name") ?? "tool";
			const fingerprint = callId || `${name}:${command ?? ""}`;
			if (fingerprint === state.lastActivityFingerprint) {
				return null;
			}
			state.lastActivityFingerprint = fingerprint;
			if (isCodexUserInputToolName(name)) {
				return {
					event: "to_review",
					metadata: {
						source: "codex",
						hookEventName: type,
						activityText: "Waiting for input",
					},
				};
			}
			return {
				event: "activity",
				metadata: {
					source: "codex",
					hookEventName: type,
					activityText: command ? `Calling ${name}: ${command}` : `Calling ${name}`,
				},
			};
		}
		return null;
	}

	if (normalizedType === "agent_message" && messageText) {
		const fingerprint = `${normalizedType}:${truncateText(messageText, 120)}`;
		if (fingerprint === state.lastActivityFingerprint) {
			return null;
		}
		state.lastActivityFingerprint = fingerprint;
		return {
			event: "activity",
			metadata: {
				source: "codex",
				hookEventName: type,
				activityText: `Agent: ${messageText}`,
			},
		};
	}

	if (normalizedType === "task_complete") {
		const finalText = lastAgentMessage || messageText;
		return {
			event: "to_review",
			metadata: {
				source: "codex",
				hookEventName: type,
				activityText: finalText ? `Final: ${finalText}` : "Waiting for review",
				finalMessage: finalText || undefined,
			},
		};
	}

	if (
		normalizedType.endsWith("_approval_request") ||
		normalizedType === "approval_request" ||
		normalizedType === "permission_request" ||
		normalizedType === "approval_requested"
	) {
		let approvalId = pickFirstString([
			extractJsonStringField(line, "id"),
			extractJsonStringField(line, "approval_id"),
			extractJsonStringField(line, "call_id"),
			message?.id,
			message?.approval_id,
			message?.call_id,
			parsed.id,
			parsed.approval_id,
			parsed.call_id,
		]);
		if (!approvalId) {
			state.approvalFallbackSeq += 1;
			approvalId = `approval_request_${state.approvalFallbackSeq}`;
		}
		if (approvalId !== state.lastApprovalId) {
			state.lastApprovalId = approvalId;
			return {
				event: "to_review",
				metadata: {
					source: "codex",
					activityText: "Waiting for approval",
					hookEventName: type,
				},
			};
		}
		return null;
	}

	if (normalizedType === "exec_command_begin" || normalizedType === "exec_command_start") {
		const callId = pickFirstString([extractJsonStringField(line, "call_id"), message?.call_id, parsed.call_id]);
		if (!callId || callId !== state.lastExecCallId) {
			state.lastExecCallId = callId;
			return {
				event: "activity",
				metadata: {
					source: "codex",
					activityText: command ? `Running command: ${command}` : "Running command",
					hookEventName: type,
				},
			};
		}
		return null;
	}

	if (normalizedType === "exec_command_end") {
		const callId = pickFirstString([extractJsonStringField(line, "call_id"), message.call_id, parsed.call_id]);
		const status = pickFirstString([
			extractJsonStringField(line, "status"),
			(message as Record<string, unknown>).status,
		]);
		const failed = status.toLowerCase() === "failed";
		const fingerprint = `${normalizedType}:${callId}:${status}`;
		if (fingerprint === state.lastActivityFingerprint) {
			return null;
		}
		state.lastActivityFingerprint = fingerprint;
		return {
			event: "activity",
			metadata: {
				source: "codex",
				hookEventName: type,
				activityText: failed
					? command
						? `Command failed: ${command}`
						: "Command failed"
					: command
						? `Command finished: ${command}`
						: "Command finished",
			},
		};
	}

	if (normalizedType.includes("tool") || normalizedType.includes("exec") || normalizedType.includes("command")) {
		const fingerprint = pickFirstString([
			extractJsonStringField(line, "call_id"),
			extractJsonStringField(line, "id"),
			type,
		]);
		if (fingerprint === state.lastActivityFingerprint) {
			return null;
		}
		state.lastActivityFingerprint = fingerprint;
		return {
			event: "activity",
			metadata: {
				source: "codex",
				activityText: command ? `Codex ${type}: ${command}` : `Codex activity: ${type}`,
				hookEventName: type,
			},
		};
	}

	return null;
}

export async function startCodexSessionWatcher(
	logPath: string,
	notify: CodexSessionWatcherNotify,
	pollIntervalMs = CODEX_LOG_POLL_INTERVAL_MS,
	options: CodexSessionWatcherOptions = {},
): Promise<() => Promise<void>> {
	const state = createCodexWatcherState();
	const watcherCwd = options.cwd?.trim() ?? "";
	const sessionsRoot = options.sessionsRoot ?? join(homedir(), ".codex", "sessions");
	const rolloutPollIntervalMs = options.rolloutPollIntervalMs ?? CODEX_ROLLOUT_POLL_INTERVAL_MS;
	const watcherStartedAtMs = Date.now();
	let rolloutLogPath = "";
	let rolloutOffset = 0;
	let rolloutRemainder = "";
	let lastRolloutPollAt = 0;

	const pollRolloutActivity = async () => {
		if (!watcherCwd) {
			return;
		}
		const now = Date.now();
		if (now - lastRolloutPollAt < rolloutPollIntervalMs) {
			return;
		}
		lastRolloutPollAt = now;

		if (!rolloutLogPath) {
			const resolvedRolloutPath = await findCodexRolloutFileForCwd(watcherCwd, watcherStartedAtMs, sessionsRoot);
			if (!resolvedRolloutPath) {
				return;
			}
			rolloutLogPath = resolvedRolloutPath;
			try {
				const initialStat = await stat(rolloutLogPath);
				rolloutOffset = Math.max(0, initialStat.size - CODEX_ROLLOUT_INITIAL_BACKLOG_BYTES);
			} catch {
				rolloutOffset = 0;
			}
		}

		let fileStat: Stats;
		try {
			fileStat = await stat(rolloutLogPath);
		} catch {
			rolloutLogPath = "";
			rolloutOffset = 0;
			rolloutRemainder = "";
			return;
		}
		if (fileStat.size < rolloutOffset) {
			rolloutOffset = 0;
			rolloutRemainder = "";
		}
		if (fileStat.size === rolloutOffset) {
			return;
		}

		let handle: Awaited<ReturnType<typeof open>> | null = null;
		try {
			handle = await open(rolloutLogPath, "r");
			const byteLength = fileStat.size - rolloutOffset;
			const buffer = Buffer.alloc(byteLength);
			await handle.read(buffer, 0, byteLength, rolloutOffset);
			rolloutOffset = fileStat.size;

			const combined = rolloutRemainder + buffer.toString("utf8");
			const lines = combined.split(/\r?\n/);
			rolloutRemainder = lines.pop() ?? "";

			for (const line of lines) {
				const mapped = mapCodexRolloutActivityLine(line);
				if (!mapped) {
					continue;
				}
				if (mapped.fingerprint === state.lastActivityFingerprint) {
					continue;
				}
				state.lastActivityFingerprint = mapped.fingerprint;
				notify(mapped.mapped);
			}
		} catch {
			// Ignore transient rollout read errors.
		} finally {
			await handle?.close();
		}
	};

	const poll = async () => {
		let fileStat: Stats;
		try {
			fileStat = await stat(logPath);
		} catch {
			await pollRolloutActivity();
			return;
		}
		if (fileStat.size < state.offset) {
			state.offset = 0;
			state.remainder = "";
		}
		if (fileStat.size !== state.offset) {
			let handle: Awaited<ReturnType<typeof open>> | null = null;
			try {
				handle = await open(logPath, "r");
				const byteLength = fileStat.size - state.offset;
				const buffer = Buffer.alloc(byteLength);
				await handle.read(buffer, 0, byteLength, state.offset);
				state.offset = fileStat.size;
				const combined = state.remainder + buffer.toString("utf8");
				const lines = combined.split(/\r?\n/);
				state.remainder = lines.pop() ?? "";
				for (const line of lines) {
					const mapped = parseCodexEventLine(line, state);
					if (mapped) {
						notify(mapped);
					}
				}
			} catch {
				// Ignore transient session log read errors.
			} finally {
				await handle?.close();
			}
		}

		await pollRolloutActivity();
	};

	let queuedPoll = Promise.resolve();
	const queuePoll = (): Promise<void> => {
		queuedPoll = queuedPoll.then(
			() => poll(),
			() => poll(),
		);
		return queuedPoll;
	};

	const flushRemainder = () => {
		const line = state.remainder.trim();
		if (!line) {
			return;
		}
		state.remainder = "";
		const mapped = parseCodexEventLine(line, state);
		if (mapped) {
			notify(mapped);
		}
	};

	const flushRolloutRemainder = () => {
		const line = rolloutRemainder.trim();
		if (!line) {
			return;
		}
		rolloutRemainder = "";
		const mapped = mapCodexRolloutActivityLine(line);
		if (!mapped) {
			return;
		}
		if (mapped.fingerprint === state.lastActivityFingerprint) {
			return;
		}
		state.lastActivityFingerprint = mapped.fingerprint;
		notify(mapped.mapped);
	};

	const timer = setInterval(() => {
		void queuePoll();
	}, pollIntervalMs);
	await queuePoll();
	return async () => {
		clearInterval(timer);
		await queuePoll();
		flushRemainder();
		flushRolloutRemainder();
	};
}
