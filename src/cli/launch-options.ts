import { type Command, Option } from "commander";
import { parseRuntimePort } from "../core/runtime-endpoint";

export type LaunchPort = { mode: "fixed"; value: number } | { mode: "auto" };

export interface LaunchCommandOptions {
	host?: string;
	port?: LaunchPort;
	open?: boolean;
	skipShutdownCleanup?: boolean;
	https?: boolean;
	cert?: string;
	key?: string;
	noPasscode?: boolean;
	agent?: string;
}

export interface NormalizedLaunchOptions {
	host: string | null;
	port: LaunchPort | null;
	open: boolean;
	skipShutdownCleanup: boolean;
	https: boolean;
	cert: string | null;
	key: string | null;
	noPasscode: boolean;
	agent: string | null;
}

export function parseCliPortValue(rawValue: string): LaunchPort {
	const normalized = rawValue.trim().toLowerCase();
	if (!normalized) {
		throw new Error("Missing value for --port.");
	}
	if (normalized === "auto") {
		return { mode: "auto" };
	}
	try {
		return { mode: "fixed", value: parseRuntimePort(normalized) };
	} catch {
		throw new Error(`Invalid port value: ${rawValue}. Expected an integer from 1-65535 or "auto".`);
	}
}

/**
 * Register every option that controls a Kanban runtime launch. Keep this list
 * as the single source of truth for foreground, daemon, and restart commands.
 */
export function registerLaunchOptions(command: Command): Command {
	return command
		.option("--host <ip>", "Host IP to bind the server to (default: 127.0.0.1).")
		.option("--port <number|auto>", "Runtime port (1-65535) or auto.", parseCliPortValue)
		.option("--no-open", "Do not open browser automatically.")
		.option("--skip-shutdown-cleanup", "Do not move sessions to done or delete task worktrees on shutdown.")
		.option("--https", "Enable HTTPS. Requires both --cert and --key.")
		.option("--cert <path>", "Path to a TLS certificate PEM file (implies HTTPS).")
		.option("--key <path>", "Path to a TLS private key PEM file (implies HTTPS).")
		.option(
			"--no-passcode",
			"Disable auto-generated passcode for remote access (for advanced users behind a reverse proxy).",
		)
		.addOption(new Option("--agent <id>", "Deprecated compatibility flag. Ignored.").hideHelp());
}

export function normalizeLaunchOptions(options: LaunchCommandOptions): NormalizedLaunchOptions {
	return {
		host: options.host ?? null,
		port: options.port ?? null,
		open: options.open !== false,
		skipShutdownCleanup: options.skipShutdownCleanup === true,
		https: options.https === true,
		cert: options.cert ?? null,
		key: options.key ?? null,
		noPasscode: options.noPasscode === true,
		agent: options.agent ?? null,
	};
}

export function getOptionWasProvided(command: Command, optionName: string): boolean {
	return command.getOptionValueSource(optionName) === "cli";
}

export function toLaunchArgs(options: NormalizedLaunchOptions, optionsProvided?: Set<string>): string[] {
	const args: string[] = [];
	const include = (name: string, value: boolean): boolean => optionsProvided?.has(name) ?? value;

	if (options.host !== null && include("host", true)) {
		args.push("--host", options.host);
	}
	if (options.port && include("port", true)) {
		args.push("--port", options.port.mode === "auto" ? "auto" : String(options.port.value));
	}
	if (include("open", !options.open)) {
		if (!options.open) {
			args.push("--no-open");
		}
	}
	if (options.skipShutdownCleanup && include("skipShutdownCleanup", true)) {
		args.push("--skip-shutdown-cleanup");
	}
	if (options.https && include("https", true)) {
		args.push("--https");
	}
	if (options.cert !== null && include("cert", true)) {
		args.push("--cert", options.cert);
	}
	if (options.key !== null && include("key", true)) {
		args.push("--key", options.key);
	}
	if (options.noPasscode && include("noPasscode", true)) {
		args.push("--no-passcode");
	}
	if (options.agent !== null && include("agent", true)) {
		args.push("--agent", options.agent);
	}
	return args;
}
