export interface TerminalController {
	input: (text: string) => boolean;
	paste: (text: string) => boolean;
}

const controllersByTaskId = new Map<string, TerminalController>();

export function getTerminalController(taskId: string): TerminalController | null {
	return controllersByTaskId.get(taskId) ?? null;
}

export function registerTerminalController(taskId: string, controller: TerminalController): () => void {
	controllersByTaskId.set(taskId, controller);
	return () => {
		if (controllersByTaskId.get(taskId) === controller) {
			controllersByTaskId.delete(taskId);
		}
	};
}
