import type { RuntimeAcpTurnRequest, RuntimeAcpTurnResponse } from "./api-contract.js";
import { AcpRuntimeSessionManager } from "./session-manager.js";

const sessionManager = new AcpRuntimeSessionManager();

interface RunAcpTurnOptions {
	commandLine: string;
	cwd: string;
	request: RuntimeAcpTurnRequest;
}

export async function runAcpTurn(options: RunAcpTurnOptions): Promise<RuntimeAcpTurnResponse> {
	return sessionManager.runTurn({
		commandLine: options.commandLine,
		cwd: options.cwd,
		request: {
			taskId: options.request.taskId,
			prompt: options.request.prompt,
		},
	});
}

export async function cancelAcpTurn(taskId: string): Promise<boolean> {
	return sessionManager.cancelTask(taskId);
}

export async function shutdownAcpRuntimeSessions(): Promise<void> {
	await sessionManager.disposeAll();
}
