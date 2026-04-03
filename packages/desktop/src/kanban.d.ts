/** Type declaration for the kanban/runtime-start subpath export. */
declare module "kanban/runtime-start" {
	export interface RuntimeOptions {
		host?: string;
		port?: number | "auto";
		authToken?: string;
		isLocal?: boolean;
		openInBrowser?: boolean;
		pickDirectory?: () => Promise<string | null>;
		warn?: (message: string) => void;
		directoryBrowseRoot?: string;
	}
	export interface RuntimeHandle {
		url: string;
		shutdown: (options?: { skipSessionCleanup?: boolean }) => Promise<void>;
	}
	export function startRuntime(options?: RuntimeOptions): Promise<RuntimeHandle>;
}

/** Type declaration for the kanban package. */
declare module "kanban" {
	export function listWorkspaceIndexEntries(): Promise<Array<{ repoPath: string }>>;
	export function loadWorkspaceState(repoPath: string): Promise<{
		board: {
			columns: Array<{
				id: string;
				cards: Array<{ id: string }>;
			}>;
		};
	}>;
}
