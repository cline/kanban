import { spawn } from "node:child_process";
import type { Stats } from "node:fs";
import { access, open, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTRPCProxyClient, httpBatchLink, TRPCClientError } from "@trpc/client";

import type { RuntimeHookEvent } from "../core/api-contract.js";
import { buildKanbanCommandParts } from "../core/kanban-command.js";
import { buildKanbanRuntimeUrl } from "../core/runtime-endpoint.js";
import { parseHookRuntimeContextFromEnv } from "../terminal/hook-runtime-context.js";
import type { RuntimeAppRouter } from "../trpc/app-router.js";

const VALID_EVENTS = new Set<RuntimeHookEvent>(["to_review", "to_in_progress"]);
const CODEX_LOG_WAIT_ATTEMPTS = 200;
const CODEX_LOG_WAIT_DELAY_MS = 50;
const CODEX_LOG_POLL_INTERVAL_MS = 200;

interface HooksIngestArgs {
	event: RuntimeHookEvent;
	taskId: string;
	workspaceId: string;
}

interface CodexWrapperArgs {
	realBinary: string;
	agentArgs: string[];
}

interface CodexWatcherState {
	lastTurnId: string;
	lastApprovalId: string;
	lastExecCallId: string;
	approvalFallbackSeq: number;
	offset: number;
	remainder: string;
}

interface CodexEventPayload {
	type?: unknown;
	turn_id?: unknown;
	id?: unknown;
	approval_id?: unknown;
	call_id?: unknown;
}

interface CodexSessionLogLine {
	dir?: unknown;
	kind?: unknown;
	msg?: unknown;
	turn_id?: unknown;
	id?: unknown;
	approval_id?: unknown;
	call_id?: unknown;
}

function formatError(error: unknown): string {
	if (error instanceof TRPCClientError) {
		return error.message;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
	let timeoutHandle: NodeJS.Timeout | null = null;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutHandle = setTimeout(() => {
			reject(new Error(`${label} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
	});
	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timeoutHandle) {
			clearTimeout(timeoutHandle);
		}
	}
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function parseEventArg(argv: string[]): RuntimeHookEvent {
	let event: string | null = null;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		const next = argv[i + 1];
		if (arg === "--event" && next) {
			event = next;
			i += 1;
			continue;
		}
		if (arg.startsWith("--event=")) {
			event = arg.slice("--event=".length);
		}
	}
	if (!event) {
		throw new Error("Missing required flag: --event");
	}
	if (!VALID_EVENTS.has(event as RuntimeHookEvent)) {
		throw new Error(`Invalid event "${event}". Must be one of: ${[...VALID_EVENTS].join(", ")}`);
	}
	return event as RuntimeHookEvent;
}

function parseHooksIngestArgs(argv: string[]): HooksIngestArgs {
	const event = parseEventArg(argv);
	const context = parseHookRuntimeContextFromEnv();
	return {
		event,
		taskId: context.taskId,
		workspaceId: context.workspaceId,
	};
}

async function ingestHookEvent(args: HooksIngestArgs): Promise<void> {
	const trpcClient = createTRPCProxyClient<RuntimeAppRouter>({
		links: [
			httpBatchLink({
				url: buildKanbanRuntimeUrl("/api/trpc"),
				maxItems: 1,
			}),
		],
	});
	const ingestResponse = await withTimeout(
		trpcClient.hooks.ingest.mutate({
			taskId: args.taskId,
			workspaceId: args.workspaceId,
			event: args.event,
		}),
		3000,
		"kanban hooks ingest",
	);
	if (ingestResponse.ok === false) {
		throw new Error(ingestResponse.error ?? "Hook ingest failed");
	}
}

function spawnDetachedKanban(args: string[]): void {
	try {
		const commandParts = buildKanbanCommandParts(args);
		const child = spawn(commandParts[0], commandParts.slice(1), {
			detached: true,
			stdio: "ignore",
			env: process.env,
		});
		child.unref();
	} catch {
		// Best effort: hook notification failures should never block agents.
	}
}

function getString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function parseCodexWrapperArgs(argv: string[]): CodexWrapperArgs {
	let realBinary = "";
	const passthroughArgs: string[] = [];

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--real-binary") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("Missing value for --real-binary");
			}
			realBinary = value;
			index += 1;
			continue;
		}
		if (arg.startsWith("--real-binary=")) {
			realBinary = arg.slice("--real-binary=".length);
			continue;
		}
		if (arg === "--") {
			passthroughArgs.push(...argv.slice(index + 1));
			break;
		}
		passthroughArgs.push(arg);
	}

	if (!realBinary.trim()) {
		throw new Error("Missing required flag: --real-binary");
	}
	return {
		realBinary,
		agentArgs: passthroughArgs,
	};
}

function parseCodexSessionLogLine(line: string): CodexSessionLogLine | null {
	try {
		const parsed = JSON.parse(line) as CodexSessionLogLine;
		if (getString(parsed.dir) !== "to_tui" || getString(parsed.kind) !== "codex_event") {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

function parseCodexEventPayload(line: CodexSessionLogLine): CodexEventPayload | null {
	if (!line.msg || typeof line.msg !== "object" || Array.isArray(line.msg)) {
		return null;
	}
	return line.msg as CodexEventPayload;
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

function parseCodexEventLine(line: string, state: CodexWatcherState): RuntimeHookEvent | null {
	const parsed = parseCodexSessionLogLine(line);
	if (!parsed) {
		return null;
	}
	const message = parseCodexEventPayload(parsed);
	const type = getString(message?.type);
	if (!type) {
		return null;
	}

	if (type === "task_started") {
		const turnId = pickFirstString([
			extractJsonStringField(line, "turn_id"),
			message?.turn_id,
			parsed.turn_id,
			"task_started",
		]);
		if (turnId !== state.lastTurnId) {
			state.lastTurnId = turnId;
			return "to_in_progress";
		}
		return null;
	}

	if (type.endsWith("_approval_request")) {
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
			return "to_review";
		}
		return null;
	}

	if (type === "exec_command_begin") {
		const callId = pickFirstString([extractJsonStringField(line, "call_id"), message?.call_id, parsed.call_id]);
		if (!callId || callId !== state.lastExecCallId) {
			state.lastExecCallId = callId;
			return "to_in_progress";
		}
	}

	return null;
}

async function waitForFile(path: string): Promise<boolean> {
	for (let attempt = 0; attempt < CODEX_LOG_WAIT_ATTEMPTS; attempt += 1) {
		try {
			await access(path);
			return true;
		} catch {
			await sleep(CODEX_LOG_WAIT_DELAY_MS);
		}
	}
	return false;
}

async function startCodexSessionWatcher(logPath: string): Promise<() => void> {
	const state: CodexWatcherState = {
		lastTurnId: "",
		lastApprovalId: "",
		lastExecCallId: "",
		approvalFallbackSeq: 0,
		offset: 0,
		remainder: "",
	};

	const poll = async () => {
		let fileStat: Stats;
		try {
			fileStat = await stat(logPath);
		} catch {
			return;
		}
		if (fileStat.size < state.offset) {
			state.offset = 0;
			state.remainder = "";
		}
		if (fileStat.size === state.offset) {
			return;
		}

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
				const event = parseCodexEventLine(line, state);
				if (event) {
					spawnDetachedKanban(["hooks", "notify", "--event", event]);
				}
			}
		} catch {
			// Ignore transient session log read errors.
		} finally {
			await handle?.close();
		}
	};

	const timer = setInterval(() => {
		void poll();
	}, CODEX_LOG_POLL_INTERVAL_MS);
	void poll();
	return () => {
		clearInterval(timer);
	};
}

async function runHooksNotify(argv: string[]): Promise<void> {
	try {
		const args = parseHooksIngestArgs(argv.slice(2));
		await ingestHookEvent(args);
	} catch {
		// Best effort only.
	}
}

async function readStdinText(): Promise<string> {
	const chunks: string[] = [];
	process.stdin.setEncoding("utf8");
	for await (const chunk of process.stdin) {
		chunks.push(chunk);
	}
	return chunks.join("");
}

function mapGeminiHookEvent(eventName: string): RuntimeHookEvent | null {
	if (eventName === "AfterAgent") {
		return "to_review";
	}
	if (eventName === "BeforeAgent" || eventName === "AfterTool") {
		return "to_in_progress";
	}
	return null;
}

async function runGeminiHookSubcommand(): Promise<void> {
	let payload = "";
	try {
		payload = await readStdinText();
	} catch {
		payload = "";
	}

	let hookEventName = "";
	try {
		const parsed = JSON.parse(payload || "{}") as { hook_event_name?: unknown };
		hookEventName = typeof parsed.hook_event_name === "string" ? parsed.hook_event_name : "";
	} catch {
		hookEventName = "";
	}

	process.stdout.write("{}\n");

	const mappedEvent = mapGeminiHookEvent(hookEventName);
	if (!mappedEvent) {
		return;
	}
	spawnDetachedKanban(["hooks", "notify", "--event", mappedEvent]);
}

async function runCodexWrapperSubcommand(argv: string[]): Promise<void> {
	let wrapperArgs: CodexWrapperArgs;
	try {
		wrapperArgs = parseCodexWrapperArgs(argv.slice(2));
	} catch (error) {
		process.stderr.write(`kanban hooks codex-wrapper: ${formatError(error)}\n`);
		process.exitCode = 1;
		return;
	}

	const childEnv: NodeJS.ProcessEnv = { ...process.env };
	let shuttingDown = false;
	let stopWatcher = () => {};

	let shouldWatchSessionLog = false;
	try {
		parseHookRuntimeContextFromEnv(childEnv);
		shouldWatchSessionLog = true;
	} catch {
		shouldWatchSessionLog = false;
	}

	if (shouldWatchSessionLog) {
		childEnv.CODEX_TUI_RECORD_SESSION = "1";
		if (!childEnv.CODEX_TUI_SESSION_LOG_PATH) {
			childEnv.CODEX_TUI_SESSION_LOG_PATH = join(
				tmpdir(),
				`kanban-codex-session-${process.pid}_${Date.now()}.jsonl`,
			);
		}
		const sessionLogPath = childEnv.CODEX_TUI_SESSION_LOG_PATH;
		if (sessionLogPath) {
			void (async () => {
				const exists = await waitForFile(sessionLogPath);
				if (!exists || shuttingDown) {
					return;
				}
				stopWatcher = await startCodexSessionWatcher(sessionLogPath);
				if (shuttingDown) {
					stopWatcher();
				}
			})();
		}
	}

	const reviewNotifyCommandParts = buildKanbanCommandParts(["hooks", "notify", "--event", "to_review"]);
	const notifyConfig = `notify=${JSON.stringify(reviewNotifyCommandParts)}`;
	const child = spawn(wrapperArgs.realBinary, ["-c", notifyConfig, ...wrapperArgs.agentArgs], {
		stdio: "inherit",
		env: childEnv,
	});

	const forwardSignal = (signal: NodeJS.Signals) => {
		if (!child.killed) {
			child.kill(signal);
		}
	};

	const onSigint = () => {
		forwardSignal("SIGINT");
	};
	const onSigterm = () => {
		forwardSignal("SIGTERM");
	};

	process.on("SIGINT", onSigint);
	process.on("SIGTERM", onSigterm);

	const cleanup = () => {
		shuttingDown = true;
		stopWatcher();
		process.off("SIGINT", onSigint);
		process.off("SIGTERM", onSigterm);
	};

	await new Promise<void>((resolve) => {
		child.on("error", () => {
			cleanup();
			process.exitCode = 1;
			resolve();
		});
		child.on("exit", (code) => {
			cleanup();
			process.exitCode = code ?? 1;
			resolve();
		});
	});
}

export function isHooksSubcommand(argv: string[]): boolean {
	return argv[0] === "hooks";
}

export async function runHooksIngest(argv: string[]): Promise<void> {
	let args: HooksIngestArgs;
	try {
		args = parseHooksIngestArgs(argv.slice(2));
	} catch (error) {
		process.stderr.write(`kanban hooks ingest: ${formatError(error)}\n`);
		process.exitCode = 1;
		return;
	}

	try {
		await ingestHookEvent(args);
	} catch (error) {
		process.stderr.write(`kanban hooks ingest: ${formatError(error)}\n`);
		process.exitCode = 1;
	}
}

export async function runHooksSubcommand(argv: string[]): Promise<void> {
	const subcommand = argv[1];
	if (subcommand === "ingest") {
		await runHooksIngest(argv);
		return;
	}
	if (subcommand === "notify") {
		await runHooksNotify(argv);
		return;
	}
	if (subcommand === "gemini-hook") {
		await runGeminiHookSubcommand();
		return;
	}
	if (subcommand === "codex-wrapper") {
		await runCodexWrapperSubcommand(argv);
		return;
	}
	process.stderr.write(
		`kanban hooks: unknown subcommand "${subcommand ?? ""}". Expected one of: ingest, notify, gemini-hook, codex-wrapper\n`,
	);
	process.exitCode = 1;
}
