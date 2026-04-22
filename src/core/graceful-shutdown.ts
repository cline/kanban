/*
Kanban has to shut down cleanly across several launch shapes:

- `kanban`
- `npx kanban`
- `cline --kanban`
- `npx cline --kanban`

Those are not equivalent from a signal-delivery perspective.

When the user presses Ctrl+C, the terminal sends SIGINT to the foreground process
group, not just to "the real app". In wrapper-based launches, Kanban can receive:

1. the original SIGINT directly from the terminal process group
2. an immediate second SIGINT replayed by a wrapper such as `npx` or `npm exec`

That means one physical Ctrl+C can look like two SIGINTs by the time it reaches
Kanban. A generic graceful-shutdown helper cannot tell whether the second signal
was:

- a true second Ctrl+C from the user
- a duplicate forwarded by a parent wrapper during its own shutdown

We used to rely on a generic helper with the common policy "first signal starts
graceful shutdown, second signal force exits". That works for direct launches,
but it breaks under wrapper launches because the replayed SIGINT gets mistaken
for an intentional force-quit request. The result is that Kanban can bail out
mid-cleanup even though the user only pressed Ctrl+C once.

This module keeps the shutdown logic local so we can encode the one piece of
context a generic library does not have: some launch environments are known to
replay signals. We detect those environments conservatively, then suppress only
an immediate duplicate copy of the same signal while shutdown is already in
progress.

Important design constraints:

- We only suppress duplicates for wrapper-style launches, not normal direct runs.
- We only suppress the same signal as the one that started shutdown.
- We only suppress duplicates for a short window.
- A later second Ctrl+C still force exits.
- Timeout behavior is preserved so a stuck shutdown cannot hang forever.

The small tradeoff is intentional: in wrapper launches, a human pressing Ctrl+C
twice extremely quickly may have the second press treated as a wrapper replay if
it lands inside the duplicate window. In practice that is much less harmful than
the old behavior, where a single Ctrl+C under `npx` or `cline --kanban` could be
misread as a double interrupt and force exit immediately.
*/
const DEFAULT_HANDLED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const DEFAULT_DUPLICATE_SIGNAL_WINDOW_MS = 750;
const TRANSIENT_CLI_CACHE_PATH_MARKERS = [
	"/.npm/_npx/",
	"/npm/_npx/",
	"/npm-cache/_npx/",
	"/.npx/",
	"/pnpm/dlx/",
	"/.yarn/cache/",
	"/bunx-",
] as const;

export type HandledShutdownSignal = (typeof DEFAULT_HANDLED_SIGNALS)[number];

export interface GracefulShutdownProcess {
	on(signal: HandledShutdownSignal, listener: () => void): unknown;
	off(signal: HandledShutdownSignal, listener: () => void): unknown;
}

interface GracefulShutdownOptions {
	delayMs: number;
	onShutdown: (signal: HandledShutdownSignal) => Promise<void>;
	onShutdownError?: (error: unknown) => void;
	onSecondSignal?: (signal: HandledShutdownSignal) => void;
	onTimeout?: (delayMs: number) => void;
	process: GracefulShutdownProcess;
	exit: (code: number) => void;
	reraiseSignal?: (signal: HandledShutdownSignal) => void;
	suppressImmediateDuplicateSignals?: boolean;
	duplicateSignalWindowMs?: number;
	now?: () => number;
}

export function getExitCodeForSignal(signal: HandledShutdownSignal | null): number {
	switch (signal) {
		case "SIGHUP":
			return 129;
		case "SIGINT":
			return 130;
		case "SIGTERM":
			return 143;
		default:
			return 0;
	}
}

function normalizePath(path: string): string {
	return path.replaceAll("\\", "/").toLowerCase();
}

export function shouldSuppressImmediateDuplicateShutdownSignals(options?: {
	argv?: string[];
	env?: NodeJS.ProcessEnv;
}): boolean {
	const env = options?.env ?? process.env;
	if (typeof env.npm_execpath === "string" && env.npm_execpath.length > 0) {
		return true;
	}

	const argv = options?.argv ?? process.argv;
	const entrypointPath = argv[1];
	if (typeof entrypointPath !== "string" || entrypointPath.length === 0) {
		return false;
	}

	const normalizedPath = normalizePath(entrypointPath);
	return TRANSIENT_CLI_CACHE_PATH_MARKERS.some((marker) => normalizedPath.includes(marker));
}

export function installGracefulShutdownHandlers(options: GracefulShutdownOptions): {
	uninstall: () => void;
} {
	const processRef = options.process;
	const now = options.now ?? (() => Date.now());
	const duplicateSignalWindowMs = options.duplicateSignalWindowMs ?? DEFAULT_DUPLICATE_SIGNAL_WINDOW_MS;
	const signalListeners = new Map<HandledShutdownSignal, () => void>();
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let shutdownPromise: Promise<void> | null = null;
	let shutdownSignal: HandledShutdownSignal | null = null;
	let shutdownStartedAt = 0;
	let finalized = false;
	let installed = true;

	const uninstall = () => {
		if (!installed) {
			return;
		}
		installed = false;
		for (const [signal, listener] of signalListeners) {
			processRef.off(signal, listener);
		}
		signalListeners.clear();
	};

	const finalizeExit = (code: number) => {
		if (finalized) {
			return;
		}
		finalized = true;
		uninstall();
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
		if (shutdownSignal && options.reraiseSignal) {
			options.reraiseSignal(shutdownSignal);
			return;
		}
		options.exit(code);
	};

	const startShutdown = (signal: HandledShutdownSignal) => {
		if (shutdownPromise !== null) {
			return;
		}

		shutdownSignal = signal;
		shutdownStartedAt = now();
		timeoutId = setTimeout(() => {
			options.onTimeout?.(options.delayMs);
			finalizeExit(1);
		}, options.delayMs);

		shutdownPromise = (async () => {
			try {
				await options.onShutdown(signal);
				finalizeExit(getExitCodeForSignal(signal));
			} catch (error) {
				options.onShutdownError?.(error);
				finalizeExit(1);
			}
		})();
	};

	const handleSignal = (signal: HandledShutdownSignal) => {
		if (shutdownPromise === null) {
			startShutdown(signal);
			return;
		}

		if (
			options.suppressImmediateDuplicateSignals === true &&
			signal === shutdownSignal &&
			now() - shutdownStartedAt <= duplicateSignalWindowMs
		) {
			return;
		}

		options.onSecondSignal?.(signal);
		finalizeExit(getExitCodeForSignal(signal));
	};

	for (const signal of DEFAULT_HANDLED_SIGNALS) {
		const listener = () => {
			handleSignal(signal);
		};
		signalListeners.set(signal, listener);
		processRef.on(signal, listener);
	}

	return { uninstall };
}
