import { createTRPCProxyClient, httpBatchLink, TRPCClientError } from "@trpc/client";

import type { RuntimeHookEvent } from "./runtime/api-contract.js";
import { parseHookRuntimeContextFromEnv } from "./runtime/terminal/hook-runtime-context.js";
import type { RuntimeAppRouter } from "./runtime/trpc/app-router.js";

const VALID_EVENTS = new Set<RuntimeHookEvent>(["review", "inprogress"]);

interface HooksIngestArgs {
	event: RuntimeHookEvent;
	taskId: string;
	workspaceId: string;
	port: number;
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

	const trpcClient = createTRPCProxyClient<RuntimeAppRouter>({
		links: [
			httpBatchLink({
				url: `http://127.0.0.1:${args.port}/api/trpc`,
				maxItems: 1,
			}),
		],
	});

	try {
		const ingestResponse = await withTimeout(
			trpcClient.hooks.ingest.mutate({
				taskId: args.taskId,
				workspaceId: args.workspaceId,
				event: args.event,
			}),
			3000,
			"kanbanana hooks ingest",
		);

		if (ingestResponse.ok === false) {
			const errorMessage = ingestResponse.error ?? "Hook ingest failed";
			process.stderr.write(`kanbanana hooks ingest: ${errorMessage}\n`);
			process.exitCode = 1;
		}
	} catch (error) {
		const message =
			error instanceof TRPCClientError ? error.message : error instanceof Error ? error.message : String(error);
		process.stderr.write(`kanbanana hooks ingest: ${message}\n`);
		process.exitCode = 1;
	}
}
