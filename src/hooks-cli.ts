import type { RuntimeHookEvent, RuntimeHookIngestResponse } from "./runtime/api-contract.js";

const VALID_EVENTS = new Set<RuntimeHookEvent>(["review", "inprogress"]);

interface HooksIngestArgs {
	taskId: string;
	event: RuntimeHookEvent;
	port: number;
}

function parseHooksIngestArgs(argv: string[]): HooksIngestArgs {
	let taskId: string | null = null;
	let event: string | null = null;
	let port: string | null = null;

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		const next = argv[i + 1];
		if (arg === "--task-id" && next) {
			taskId = next;
			i += 1;
		} else if (arg === "--event" && next) {
			event = next;
			i += 1;
		} else if (arg === "--port" && next) {
			port = next;
			i += 1;
		}
	}

	if (!taskId) {
		throw new Error("Missing required flag: --task-id");
	}
	if (!event) {
		throw new Error("Missing required flag: --event");
	}
	if (!VALID_EVENTS.has(event as RuntimeHookEvent)) {
		throw new Error(`Invalid event "${event}". Must be one of: ${[...VALID_EVENTS].join(", ")}`);
	}
	if (!port) {
		throw new Error("Missing required flag: --port");
	}
	const portNumber = Number.parseInt(port, 10);
	if (!Number.isFinite(portNumber) || portNumber < 1 || portNumber > 65535) {
		throw new Error(`Invalid port "${port}". Must be a number between 1 and 65535`);
	}

	return { taskId, event: event as RuntimeHookEvent, port: portNumber };
}

export function isHooksSubcommand(argv: string[]): boolean {
	return argv[0] === "hooks" && argv[1] === "ingest";
}

export async function runHooksIngest(argv: string[]): Promise<void> {
	let args: HooksIngestArgs;
	try {
		args = parseHooksIngestArgs(argv.slice(2));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`kanbanana hooks ingest: ${message}\n`);
		process.exitCode = 1;
		return;
	}

	const url = `http://127.0.0.1:${args.port}/api/hooks/ingest`;
	const body = JSON.stringify({ taskId: args.taskId, event: args.event });
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 3000);

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
			signal: controller.signal,
		});

		// Hook events can legitimately race with session state updates.
		// A 409 here means "no-op for current state", not a fatal failure.
		if (response.status === 409) {
			return;
		}

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			let errorMessage = `HTTP ${response.status}`;
			try {
				const parsed = JSON.parse(text) as RuntimeHookIngestResponse;
				if (parsed.error) {
					errorMessage = parsed.error;
				}
			} catch {
				if (text) {
					errorMessage = text;
				}
			}
			process.stderr.write(`kanbanana hooks ingest: ${errorMessage}\n`);
			process.exitCode = 1;
			return;
		}

		const payload = (await response.json().catch(() => null)) as RuntimeHookIngestResponse | null;
		if (payload && payload.ok === false) {
			process.stderr.write(`kanbanana hooks ingest: ${payload.error ?? "Hook ingest failed"}\n`);
			process.exitCode = 1;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`kanbanana hooks ingest: ${message}\n`);
		process.exitCode = 1;
	} finally {
		clearTimeout(timeout);
	}
}
