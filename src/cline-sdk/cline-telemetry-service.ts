import * as os from "node:os";
import { type BasicLogger, createClineTelemetryServiceConfig, type ITelemetryService } from "@clinebot/shared";
import packageJson from "../../package.json" with { type: "json" };
import { createConfiguredTelemetryService, LoggerTelemetryAdapter } from "./sdk-runtime-boundary.js";

type MutableTelemetryService = ITelemetryService & {
	addAdapter?: (adapter: LoggerTelemetryAdapter) => void;
};

const appVersion = typeof packageJson.version === "string" ? packageJson.version : "0.1.0";

let telemetrySingleton:
	| {
			telemetry: ITelemetryService;
			dispose: () => Promise<void>;
			loggerAttached: boolean;
	  }
	| undefined;

export function getCliTelemetryService(logger?: BasicLogger): ITelemetryService {
	if (!telemetrySingleton) {
		const config = createClineTelemetryServiceConfig({
			metadata: {
				extension_version: appVersion,
				cline_type: "kanban",
				platform: "kanban",
				platform_version: process.version,
				os_type: os.platform(),
				os_version: os.version(),
			},
		});
		const { telemetry, provider } = createConfiguredTelemetryService({
			...config,
			logger,
		});
		telemetrySingleton = {
			telemetry,
			loggerAttached: Boolean(logger),
			dispose: async () => {
				await Promise.allSettled([telemetry.dispose(), provider?.dispose()]);
			},
		};
	}
	if (
		logger &&
		telemetrySingleton.loggerAttached !== true &&
		typeof (telemetrySingleton.telemetry as MutableTelemetryService).addAdapter === "function"
	) {
		(telemetrySingleton.telemetry as MutableTelemetryService).addAdapter?.(new LoggerTelemetryAdapter({ logger }));
		telemetrySingleton.loggerAttached = true;
	}
	return telemetrySingleton.telemetry;
}

export async function disposeCliTelemetryService(): Promise<void> {
	if (!telemetrySingleton) {
		return;
	}
	const current = telemetrySingleton;
	telemetrySingleton = undefined;
	await current.dispose();
}
