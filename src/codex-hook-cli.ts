import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { RuntimeHookEvent } from "./core/api-contract";
import { type HookCommandMetadataOptionValues, runCodexHookSubcommand } from "./commands/hooks";

const VALID_EVENTS = new Set<RuntimeHookEvent>(["to_review", "to_in_progress", "activity"]);
const OPTION_KEYS = {
	"--activity-text": "activityText",
	"--event": "event",
	"--final-message": "finalMessage",
	"--hook-event-name": "hookEventName",
	"--metadata-base64": "metadataBase64",
	"--notification-type": "notificationType",
	"--source": "source",
	"--tool-name": "toolName",
} as const;

interface ParsedCodexHookArguments {
	event: RuntimeHookEvent;
	options: HookCommandMetadataOptionValues;
	payload: string | undefined;
}

function requireOptionValue(name: string, value: string | undefined): string {
	if (value === undefined || value.length === 0) {
		throw new Error(`${name} requires a value.`);
	}
	return value;
}

export function parseCodexHookArguments(argv: string[]): ParsedCodexHookArguments {
	const values: HookCommandMetadataOptionValues & { event?: string } = {};
	let payload: string | undefined;

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (!argument) {
			continue;
		}
		if (!argument.startsWith("--")) {
			if (payload !== undefined) {
				throw new Error("Only one hook payload argument is supported.");
			}
			payload = argument;
			continue;
		}

		const separatorIndex = argument.indexOf("=");
		const name = separatorIndex === -1 ? argument : argument.slice(0, separatorIndex);
		if (!(name in OPTION_KEYS)) {
			throw new Error(`Unknown option: ${name}`);
		}
		const inlineValue = separatorIndex === -1 ? undefined : argument.slice(separatorIndex + 1);
		const value = requireOptionValue(name, inlineValue ?? argv[++index]);
		const key = OPTION_KEYS[name as keyof typeof OPTION_KEYS];
		values[key] = value;
	}

	if (!values.event || !VALID_EVENTS.has(values.event as RuntimeHookEvent)) {
		throw new Error("--event must be one of: to_review, to_in_progress, activity.");
	}
	const { event, ...options } = values;
	return {
		event: event as RuntimeHookEvent,
		options,
		payload,
	};
}

async function main(): Promise<void> {
	try {
		const parsed = parseCodexHookArguments(process.argv.slice(2));
		await runCodexHookSubcommand(parsed.event, parsed.options, parsed.payload);
	} catch {
		process.stdout.write("{}\n");
	}
}

const invokedEntrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedEntrypoint === import.meta.url) {
	void main();
}
