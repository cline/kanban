import type {
	RuntimeAcpTurnRequest,
	RuntimeAcpTurnResponse,
	RuntimeAcpTurnStatus,
	RuntimeAvailableCommand,
	RuntimeTimelineEntry,
} from "./api-contract.js";
import { AcpRuntimeSessionManager } from "./session-manager.js";

const sessionManager = new AcpRuntimeSessionManager();

interface RunAcpTurnOptions {
	commandLine: string;
	cwd: string;
	request: RuntimeAcpTurnRequest;
	listeners?: {
		onEntry?: (entry: RuntimeTimelineEntry) => void;
		onStatus?: (status: RuntimeAcpTurnStatus) => void;
		onAvailableCommands?: (commands: RuntimeAvailableCommand[]) => void;
	};
}

export async function runAcpTurn(options: RunAcpTurnOptions): Promise<RuntimeAcpTurnResponse> {
	return sessionManager.runTurn({
		commandLine: options.commandLine,
		cwd: options.cwd,
		request: {
			taskId: options.request.taskId,
			prompt: options.request.prompt,
		},
		listeners: options.listeners,
	});
}

export async function cancelAcpTurn(taskId: string): Promise<boolean> {
	return sessionManager.cancelTask(taskId);
}

export async function shutdownAcpRuntimeSessions(): Promise<void> {
	await sessionManager.disposeAll();
}
