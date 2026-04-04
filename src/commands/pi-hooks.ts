import { spawn } from "node:child_process";
import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeHookEvent, RuntimeTaskHookActivity } from "../core/api-contract";
import {
	findLatestPiSessionLog,
	mapPiSessionEntry,
	readPiSessionEntryId,
	resolvePiExitReviewActivityFromSessionDir,
} from "../terminal/pi-session-log";

export interface PiWrapperArgs {
	realBinary: string;
	sessionDir: string;
	agentArgs: string[];
}

interface PiSessionWatcherState {
	logPath: string;
	offset: number;
	remainder: string;
	knownLogPaths: Set<string>;
	seenEntryIds: Set<string>;
}

export type PiSessionEventNotify = (
	event: RuntimeHookEvent,
	metadata?: Partial<RuntimeTaskHookActivity>,
) => void | Promise<void>;

export function buildPiWrapperChildArgs(agentArgs: string[], sessionDir: string): string[] {
	const childArgs = [...agentArgs];
	const hasSessionDir = childArgs.some((arg) => {
		return arg === "--session-dir" || arg.startsWith("--session-dir=");
	});
}

export async function startPiSessionWatcher(
	sessionDir: string,
	notify: PiSessionEventNotify,
	pollIntervalMs = 250,
): Promise<() => Promise<void>> {
	const knownLogPaths = new Set<string>();
	try {
		for (const name of await readdir(sessionDir)) {
			if (name.endsWith(".jsonl")) {
				knownLogPaths.add(join(sessionDir, name));
			}
		}
	} catch {
		// Session dir may not exist yet.
	}
	const state: PiSessionWatcherState = {
		logPath: "",
		offset: 0,
		remainder: "",
		knownLogPaths,
		seenEntryIds: new Set<string>(),
	};

	const poll = async () => {
		const latestLog = await findLatestPiSessionLog(sessionDir);
		if (!latestLog) {
			return;
		}
		if (latestLog.path !== state.logPath) {
			state.logPath = latestLog.path;
			state.remainder = "";
			state.offset = state.knownLogPaths.has(latestLog.path) ? latestLog.size : 0;
			state.knownLogPaths.add(latestLog.path);
		}

		let fileStat: Awaited<ReturnType<typeof stat>>;
		try {
			fileStat = await stat(state.logPath);
		} catch {
			state.logPath = "";
			state.offset = 0;
			state.remainder = "";
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
			handle = await open(state.logPath, "r");
			const byteLength = fileStat.size - state.offset;
			const buffer = Buffer.alloc(byteLength);
			await handle.read(buffer, 0, byteLength, state.offset);
			state.offset = fileStat.size;
			const combined = state.remainder + buffer.toString("utf8");
			const lines = combined.split(/\r?\n/);
			state.remainder = lines.pop() ?? "";
			for (const line of lines) {
				const entryId = readPiSessionEntryId(line);
				if (entryId) {
					if (state.seenEntryIds.has(entryId)) {
						continue;
					}
					state.seenEntryIds.add(entryId);
				}
				for (const mapped of mapPiSessionEntry(line)) {
					await notify(mapped.event, mapped.metadata);
				}
			}
		} catch {
			// Ignore transient session read errors.
		} finally {
			await handle?.close();
		}
	};

	let queuedPoll = Promise.resolve();
	const queuePoll = (): Promise<void> => {
		queuedPoll = queuedPoll.then(
			() => poll(),
			() => poll(),
		);
		return queuedPoll;
	};

	const flushRemainder = async () => {
		const line = state.remainder.trim();
		if (!line) {
			return;
		}
		state.remainder = "";
		const entryId = readPiSessionEntryId(line);
		if (entryId) {
			if (state.seenEntryIds.has(entryId)) {
				return;
			}
			state.seenEntryIds.add(entryId);
		}
		for (const mapped of mapPiSessionEntry(line)) {
			await notify(mapped.event, mapped.metadata);
		}
	};

	const timer = setInterval(() => {
		void queuePoll();
	}, pollIntervalMs);
	await queuePoll();
	return async () => {
		clearInterval(timer);
		await queuePoll();
		await flushRemainder();
	};
}

export async function runPiWrapperSubcommand(
	wrapperArgs: PiWrapperArgs,
	notify: (
		event: RuntimeHookEvent,
		metadata: Partial<RuntimeTaskHookActivity> | undefined,
		env: NodeJS.ProcessEnv,
	) => Promise<void>,
): Promise<void> {
	const childEnv: NodeJS.ProcessEnv = { ...process.env };
	const childArgs = buildPiWrapperChildArgs(wrapperArgs.agentArgs, wrapperArgs.sessionDir);
	let pendingPiNotifications = Promise.resolve();
	const queuePiNotification = (event: RuntimeHookEvent, metadata?: Partial<RuntimeTaskHookActivity>): void => {
		pendingPiNotifications = pendingPiNotifications.then(
			() => notify(event, metadata, childEnv),
			() => notify(event, metadata, childEnv),
		);
	};
	let stopWatcher: () => Promise<void> = async () => {};
	try {
		stopWatcher = await startPiSessionWatcher(wrapperArgs.sessionDir, queuePiNotification);
	} catch {
		stopWatcher = async () => {};
	}

	const child = spawn(wrapperArgs.realBinary, childArgs, {
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

	await new Promise<void>((resolve) => {
		let finished = false;
		const finish = (exitCode: number) => {
			if (finished) {
				return;
			}
			finished = true;
			void (async () => {
				process.off("SIGINT", onSigint);
				process.off("SIGTERM", onSigterm);
				await stopWatcher();
				await pendingPiNotifications;
				if (exitCode === 0) {
					try {
						const reviewMetadata = await resolvePiExitReviewActivityFromSessionDir(wrapperArgs.sessionDir);
						if (reviewMetadata) {
							await notify("to_review", reviewMetadata, childEnv);
						}
					} catch {
						// Best effort fallback only.
					}
				}
				process.exitCode = exitCode;
				resolve();
			})();
		};

		child.on("error", () => {
			finish(1);
		});
		child.on("exit", (code) => {
			finish(code ?? 1);
		});
	});
}
