import type { RuntimeHookEvent, RuntimeHookIngestResponse } from "./runtime/api-contract.js";
import { parseHookRuntimeContextFromEnv } from "./runtime/terminal/hook-runtime-context.js";

const VALID_EVENTS = new Set<RuntimeHookEvent>(["review", "inprogress"]);

interface HooksIngestArgs {
	event: RuntimeHookEvent;
	taskId: string;
	workspaceId: string;
	port: number;
}

function parseHooksIngestArgs(argv: string[]): HooksIngestArgs {
	let event: string | null = null;

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		const next = argv[i + 1];
		if (arg === "--event" && next) {
			event = next;
			i += 1;
		}
	}

	if (!event) {
		throw new Error("Missing required flag: --event");
	}
	if (!VALID_EVENTS.has(event as RuntimeHookEvent)) {
		throw new Error(`Invalid event "${event}". Must be one of: ${[...VALID_EVENTS].join(", ")}`);
	}

	const context = parseHookRuntimeContextFromEnv();

	return {
		event: event as RuntimeHookEvent,
		taskId: context.taskId,
		workspaceId: context.workspaceId,
		port: context.port,
	};
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
	const body = JSON.stringify({
		taskId: args.taskId,
		workspaceId: args.workspaceId,
		event: args.event,
	});
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
