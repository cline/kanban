import { watch } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { startSlackClient } from "./ws-client.js";
import { loadSlackConfig, getSlackConfigPath, type SlackConfig } from "./slack-config.js";

// Slack app server (Cloudflare tunnel). Update here when the URL changes.
const SERVER_WS_URL = "wss://kanban.preview.cline.bot/connect";

const CONFIG_PATH = getSlackConfigPath();
const CONFIG_DIR = dirname(CONFIG_PATH);

/**
 * Wait for the Slack config file to appear by combining an fs.watch on
 * the config directory (fast, event-driven) with a 1 s polling fallback
 * (handles the case where the directory does not exist yet when we start).
 *
 * Resolves as soon as a valid config is readable.
 */
async function waitForConfig(signal: AbortSignal): Promise<SlackConfig> {
	return new Promise((resolve, reject) => {
		let settled = false;

		let cleanup: () => void = () => {
			/* populated below */
		};

		signal.addEventListener("abort", () => {
			if (!settled) {
				settled = true;
				cleanup();
				reject(new Error("Aborted"));
			}
		});

		// Attempt to read the config and resolve if found.
		async function tryLoad(): Promise<void> {
			if (settled) return;
			const config = await loadSlackConfig();
			if (config && !settled) {
				settled = true;
				resolve(config);
			}
		}

		// Poll every second as the reliable baseline.
		const pollInterval = setInterval(() => {
			void tryLoad();
		}, 1_000);

		let fsWatcher: ReturnType<typeof watch> | null = null;

		// Also set up an fs.watch on the directory for faster response,
		// but only after ensuring the directory exists.
		mkdir(CONFIG_DIR, { recursive: true })
			.then(() => {
				if (settled) return;
				fsWatcher = watch(CONFIG_DIR, (_event, filename) => {
					if (filename === "slack.json" || filename === null) {
						void tryLoad();
					}
				});
				fsWatcher.on("error", () => {
					// fs.watch errors are non-fatal; polling covers us.
				});
			})
			.catch(() => {
				// mkdir failure is non-fatal; polling covers us.
			});

		// Wire up the shared cleanup now that pollInterval and fsWatcher are in scope.
		cleanup = (): void => {
			clearInterval(pollInterval);
			fsWatcher?.close();
		};

		// When settled via config found, run the same cleanup.
		const originalResolve = resolve;
		resolve = (value) => {
			cleanup();
			originalResolve(value);
		};
	});
}

async function main(): Promise<void> {
	let config = await loadSlackConfig();

	if (!config) {
		console.log(
			`[index] No Slack configuration found at ${CONFIG_PATH}.`,
		);
		console.log(
			"[index] Open kanban Settings and click 'Connect to Slack' to set up the integration.",
		);
		console.log("[index] Waiting for configuration…");

		const abortController = new AbortController();

		function abort(): void {
			abortController.abort();
		}
		process.once("SIGINT", abort);
		process.once("SIGTERM", abort);

		try {
			config = await waitForConfig(abortController.signal);
		} catch {
			// Aborted via signal — fall through to clean shutdown.
			console.log("\n[index] Shutting down…");
			process.exit(0);
		}

		process.off("SIGINT", abort);
		process.off("SIGTERM", abort);

		console.log("[index] Configuration found! Starting Slack client…");
	}

	const stop = startSlackClient({
		serverWsUrl: SERVER_WS_URL,
		slackUserId: config.slackUserId,
		accessToken: config.accessToken,
		userConfig: {
			kanbanUrl: config.kanbanUrl,
			workspaceId: config.workspaceId,
		},
	});

	console.log(
		`[index] Started client for user ${config.slackUserId}` +
			` (workspace: ${config.workspaceId}, kanban: ${config.kanbanUrl})`,
	);
	console.log("[index] Waiting for @kanban mentions…");

	function shutdown(): void {
		console.log("\n[index] Shutting down…");
		stop();
		process.exit(0);
	}

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
	console.error("[index] Fatal error:", err instanceof Error ? err.message : err);
	process.exit(1);
});
