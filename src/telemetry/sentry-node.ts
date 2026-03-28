import * as Sentry from "@sentry/node";
import packageJson from "../../package.json" with { type: "json" };

const nodeSentryDsn = "https://b597cbea54f43704439be10d843699b0@o4511098366263296.ingest.us.sentry.io/4511098558087168";

const appVersion = typeof packageJson.version === "string" ? packageJson.version : "0.1.0";

let initialized = false;
const nodeSentryEnvironment =
	process.env.SENTRY_NODE_ENVIRONMENT?.trim() || process.env.NODE_ENV?.trim() || "development";

if (nodeSentryDsn) {
	Sentry.init({
		dsn: nodeSentryDsn,
		environment: nodeSentryEnvironment,
		release: `kanban@${appVersion}`,
		sendDefaultPii: false,
		initialScope: {
			tags: {
				app: "kanban",
				runtime_surface: "node",
			},
		},
	});
	initialized = true;
}

interface CaptureNodeExceptionOptions {
	area?: string;
}

export function captureNodeException(error: unknown, options?: CaptureNodeExceptionOptions): void {
	if (!initialized) {
		return;
	}

	Sentry.withScope((scope) => {
		if (options?.area) {
			scope.setTag("error_area", options.area);
		}
		Sentry.captureException(error);
	});
}

export async function flushNodeTelemetry(timeoutMs = 2_000): Promise<void> {
	if (!initialized) {
		return;
	}
	await Sentry.flush(timeoutMs);
}

export function isNodeSentryEnabled(): boolean {
	return initialized;
}
