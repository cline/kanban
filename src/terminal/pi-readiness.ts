import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

export type PiReadinessStatus = "ready" | "not_ready" | "unknown";
export type PiReadinessReason = "missing_api_key" | "model_not_found" | "unknown";

export interface PiReadinessProbeInput {
	binary: string;
	args?: string[];
	cwd: string;
	env?: Record<string, string | undefined>;
	timeoutMs?: number;
	prompt?: string;
	onLog?: (line: string) => void;
}

export interface PiReadinessProbeResult {
	status: PiReadinessStatus;
	reason: PiReadinessReason | null;
	message: string | null;
	rawMessage: string | null;
}

interface PiRpcResponseRecord {
	id?: unknown;
	type?: unknown;
	command?: unknown;
	success?: unknown;
	error?: unknown;
}

interface PiReadinessProbeDependencies {
	spawn?: typeof spawn;
}

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_PROBE_PROMPT = "Reply with READY only.";
const PROBE_REQUEST_ID = "kanban-pi-readiness";

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripKnownDocumentationSuffix(message: string): string {
	return message.replace(/\s+See\s+\S+$/u, "").trim();
}

function sanitizePiReadinessMessage(message: string): string {
	return stripKnownDocumentationSuffix(normalizeWhitespace(message));
}

function classifyPiReadinessReason(message: string | null): PiReadinessReason {
	const normalized = (message ?? "").toLowerCase();
	if (normalized.includes("no api key found")) {
		return "missing_api_key";
	}
	if (normalized.includes("model") && normalized.includes("not found")) {
		return "model_not_found";
	}
	return "unknown";
}

function formatPiReadinessMessage(rawMessage: string | null): string | null {
	if (!rawMessage) {
		return null;
	}
	const sanitized = sanitizePiReadinessMessage(rawMessage);
	if (!sanitized) {
		return null;
	}
	return `Pi is not ready: ${sanitized}`;
}

function collectLines(buffer: string, chunk: string): { nextBuffer: string; lines: string[] } {
	const parts = `${buffer}${chunk}`.split(/\r?\n/u);
	const nextBuffer = parts.pop() ?? "";
	return {
		nextBuffer,
		lines: parts,
	};
}

function parsePiRpcResponse(line: string): PiRpcResponseRecord | null {
	try {
		const parsed = JSON.parse(line);
		return isRecord(parsed) ? (parsed as PiRpcResponseRecord) : null;
	} catch {
		return null;
	}
}

function buildPiReadinessProbeArgs(args: string[]): string[] {
	const filtered: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (
			arg === "--mode" ||
			arg === "--session-dir" ||
			arg === "--session" ||
			arg === "--resume" ||
			arg === "--continue"
		) {
			index += 1;
			continue;
		}
		if (
			arg.startsWith("--mode=") ||
			arg.startsWith("--session-dir=") ||
			arg.startsWith("--session=") ||
			arg.startsWith("--resume=") ||
			arg.startsWith("--continue=")
		) {
			continue;
		}
		if (arg === "--no-session") {
			continue;
		}
		filtered.push(arg);
	}
	return ["--mode", "rpc", "--no-session", ...filtered];
}

function emitProbeLog(logger: PiReadinessProbeInput["onLog"], line: string): void {
	logger?.(line);
}

function createProbeResult(status: PiReadinessStatus, rawMessage: string | null): PiReadinessProbeResult {
	const reason = status === "not_ready" ? classifyPiReadinessReason(rawMessage) : null;
	return {
		status,
		reason,
		message: status === "not_ready" ? formatPiReadinessMessage(rawMessage) : null,
		rawMessage: rawMessage ? sanitizePiReadinessMessage(rawMessage) : null,
	};
}

function resolveProbeOutcome(promptErrors: string[], promptSucceeded: boolean, stderr: string, timedOut: boolean) {
	if (promptErrors.length > 0) {
		return createProbeResult("not_ready", promptErrors[0] ?? null);
	}
	if (promptSucceeded) {
		return createProbeResult("ready", null);
	}
	const sanitizedStderr = sanitizePiReadinessMessage(stderr);
	if (sanitizedStderr) {
		return createProbeResult("not_ready", sanitizedStderr);
	}
	return createProbeResult("unknown", timedOut ? "Timed out while probing Pi readiness." : null);
}

export async function probePiReadiness(
	input: PiReadinessProbeInput,
	deps: PiReadinessProbeDependencies = {},
): Promise<PiReadinessProbeResult> {
	const spawnProcess = deps.spawn ?? spawn;
	const timeoutMs = input.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
	const prompt = input.prompt?.trim() || DEFAULT_PROBE_PROMPT;
	const args = buildPiReadinessProbeArgs(input.args ?? []);
	const child = spawnProcess(input.binary, args, {
		cwd: input.cwd,
		env: {
			...process.env,
			...input.env,
		},
		stdio: ["pipe", "pipe", "pipe"],
	});

	emitProbeLog(
		input.onLog,
		`[kanban][pi-readiness-probe] spawn ${input.binary} ${args.map((part) => JSON.stringify(part)).join(" ")}`,
	);

	let stdoutBuffer = "";
	let stderrBuffer = "";
	const stderrLines: string[] = [];
	const promptErrors: string[] = [];
	let promptSucceeded = false;
	let timedOut = false;

	const childWithStreams = child as ChildProcessWithoutNullStreams;
	childWithStreams.stdout.setEncoding("utf8");
	childWithStreams.stdout.on("data", (chunk: string) => {
		const result = collectLines(stdoutBuffer, chunk);
		stdoutBuffer = result.nextBuffer;
		for (const line of result.lines) {
			emitProbeLog(input.onLog, `[kanban][pi-readiness-probe][stdout] ${line}`);
			const parsed = parsePiRpcResponse(line);
			if (parsed && parsed.type === "response" && parsed.command === "prompt" && parsed.id === PROBE_REQUEST_ID) {
				if (parsed.success === false && typeof parsed.error === "string") {
					promptErrors.push(parsed.error);
				}
				if (parsed.success === true) {
					promptSucceeded = true;
				}
			}
		}
	});

	childWithStreams.stderr.setEncoding("utf8");
	childWithStreams.stderr.on("data", (chunk: string) => {
		const result = collectLines(stderrBuffer, chunk);
		stderrBuffer = result.nextBuffer;
		for (const line of result.lines) {
			stderrLines.push(line);
			emitProbeLog(input.onLog, `[kanban][pi-readiness-probe][stderr] ${line}`);
		}
	});

	child.on("error", (error) => {
		emitProbeLog(
			input.onLog,
			`[kanban][pi-readiness-probe][spawn-error] ${error instanceof Error ? error.message : String(error)}`,
		);
	});

	const promptCommand = JSON.stringify({ id: PROBE_REQUEST_ID, type: "prompt", message: prompt });
	emitProbeLog(input.onLog, `[kanban][pi-readiness-probe][rpc-send] ${promptCommand}`);
	childWithStreams.stdin.write(`${promptCommand}\n`);
	childWithStreams.stdin.end();

	const exitResult = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
		const timeoutHandle = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
			resolve({ code: null, signal: "SIGTERM" });
		}, timeoutMs);
		child.once("exit", (code, signal) => {
			clearTimeout(timeoutHandle);
			resolve({ code, signal });
		});
	});

	if (stdoutBuffer.trim().length > 0) {
		emitProbeLog(input.onLog, `[kanban][pi-readiness-probe][stdout] ${stdoutBuffer.trim()}`);
	}
	if (stderrBuffer.trim().length > 0) {
		stderrLines.push(stderrBuffer.trim());
		emitProbeLog(input.onLog, `[kanban][pi-readiness-probe][stderr] ${stderrBuffer.trim()}`);
	}
	emitProbeLog(
		input.onLog,
		`[kanban][pi-readiness-probe] exit code=${exitResult.code === null ? "null" : String(exitResult.code)} signal=${exitResult.signal ?? "null"}`,
	);

	return resolveProbeOutcome(promptErrors, promptSucceeded, stderrLines.join("\n"), timedOut);
}

export const piReadinessInternals = {
	buildPiReadinessProbeArgs,
	classifyPiReadinessReason,
	formatPiReadinessMessage,
	parsePiRpcResponse,
	sanitizePiReadinessMessage,
};
