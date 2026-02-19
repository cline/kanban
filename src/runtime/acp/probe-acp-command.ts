import { spawn } from "node:child_process";
import { once } from "node:events";
import { Readable, Writable } from "node:stream";

import {
	ClientSideConnection,
	ndJsonStream,
	PROTOCOL_VERSION,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type SessionNotification,
} from "@agentclientprotocol/sdk";

const PROBE_TIMEOUT_MS = 8_000;
const PROBE_SHUTDOWN_TIMEOUT_MS = 2_000;
const MAX_STDERR_BYTES = 16 * 1024;

interface ProbeClient {
	requestPermission: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
	sessionUpdate: (notification: SessionNotification) => Promise<void>;
}

export interface AcpCommandProbeResult {
	ok: boolean;
	reason?: string;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeoutHandle = setTimeout(() => {
					reject(new Error(`${label} timed out after ${ms}ms`));
				}, ms);
			}),
		]);
	} finally {
		if (timeoutHandle) {
			clearTimeout(timeoutHandle);
		}
	}
}

function summarizeProbeFailure(error: unknown, stderrBuffer: string): string {
	const errorMessage = error instanceof Error ? error.message : String(error);
	const stderr = stderrBuffer.trim();
	if (stderr) {
		return `${errorMessage}\n${stderr}`;
	}
	return errorMessage;
}

export async function probeAcpCommand(commandLine: string, cwd: string): Promise<AcpCommandProbeResult> {
	const child = spawn(commandLine, {
		cwd,
		shell: true,
		stdio: ["pipe", "pipe", "pipe"],
		env: process.env,
	});

	if (!child.stdin || !child.stdout || !child.stderr) {
		child.kill("SIGTERM");
		return {
			ok: false,
			reason: "ACP probe failed: command did not expose stdio pipes.",
		};
	}

	let stderrBuffer = "";
	child.stderr.on("data", (chunk: Buffer | string) => {
		const next = stderrBuffer + String(chunk);
		stderrBuffer = next.length <= MAX_STDERR_BYTES ? next : next.slice(0, MAX_STDERR_BYTES);
	});

	const client: ProbeClient = {
		requestPermission: async (request) => {
			const selected = request.options[0];
			if (!selected) {
				return {
					outcome: {
						outcome: "cancelled",
					},
				};
			}
			return {
				outcome: {
					outcome: "selected",
					optionId: selected.optionId,
				},
			};
		},
		sessionUpdate: async () => {},
	};

	const stream = ndJsonStream(
		Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
		Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
	);
	const connection = new ClientSideConnection(() => client, stream);

	try {
		await withTimeout(
			connection.initialize({
				protocolVersion: PROTOCOL_VERSION,
				clientInfo: {
					name: "kanbanana-probe",
					version: "0.1.0",
					title: "Kanbanana Probe",
				},
				clientCapabilities: {},
			}),
			PROBE_TIMEOUT_MS,
			"ACP probe initialize",
		);
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			reason: summarizeProbeFailure(error, stderrBuffer),
		};
	} finally {
		child.kill("SIGTERM");
		const exited = await Promise.race([
			once(child, "close").then(() => true),
			new Promise<boolean>((resolve) => {
				setTimeout(() => resolve(false), PROBE_SHUTDOWN_TIMEOUT_MS);
			}),
		]);
		if (!exited) {
			child.kill("SIGKILL");
		}
	}
}
