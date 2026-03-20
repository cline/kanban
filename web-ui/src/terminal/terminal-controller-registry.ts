export interface TerminalController {
	input: (text: string) => boolean;
	paste: (text: string) => boolean;
	waitForLikelyPrompt?: (timeoutMs: number) => Promise<boolean>;
}

const controllersByTaskId = new Map<string, TerminalController>();

export function getTerminalController(taskId: string): TerminalController | null {
	return controllersByTaskId.get(taskId) ?? null;
}

export async function waitForTerminalLikelyPrompt(taskId: string, timeoutMs: number): Promise<boolean> {
	const controller = getTerminalController(taskId);
	if (!controller?.waitForLikelyPrompt) {
		return false;
	}
	return await controller.waitForLikelyPrompt(timeoutMs);
}

export function registerTerminalController(taskId: string, controller: TerminalController): () => void {
	controllersByTaskId.set(taskId, controller);
	return () => {
		if (controllersByTaskId.get(taskId) === controller) {
			controllersByTaskId.delete(taskId);
		}
	};
}
