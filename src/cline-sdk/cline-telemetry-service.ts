import * as os from "node:os";
import { type BasicLogger, createClineTelemetryServiceConfig, type ITelemetryService } from "@clinebot/core";
import { createConfiguredTelemetryService } from "@clinebot/core/telemetry";
import packageJson from "../../package.json" with { type: "json" };

const appVersion = typeof packageJson.version === "string" ? packageJson.version : "0.1.0";

let telemetrySingleton:
	| {
			telemetry: ITelemetryService;
			loggerAttached: boolean;
	  }
	| undefined;

export function getCliTelemetryService(logger?: BasicLogger): ITelemetryService {
	if (!telemetrySingleton) {
		const { telemetry } = createConfiguredTelemetryService({
			...createClineTelemetryServiceConfig({
				metadata: {
					extension_version: appVersion,
					cline_type: "kanban",
					platform: "kanban",
					platform_version: process.version,
					os_type: os.platform(),
					os_version: os.version(),
				},
			}),
			logger,
		});

		telemetrySingleton = {
			telemetry,
			loggerAttached: Boolean(logger),
		};
	}
	if (logger && telemetrySingleton.loggerAttached !== true) {
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
	await current.telemetry.dispose();
}
