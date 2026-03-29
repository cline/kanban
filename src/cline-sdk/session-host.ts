import { getCliTelemetryService } from "./cline-telemetry-service.js";
import { type ClineSdkSessionHost, createSessionHost } from "./sdk-runtime-boundary.js";

export async function createClineSdkSessionHost(): Promise<ClineSdkSessionHost> {
	return await createSessionHost({
		backendMode: "auto",
		autoStartRpcServer: true,
		telemetry: getCliTelemetryService(),
	});
}
