import { type ClineRuntimeSetup, createClineRuntimeSetup } from "./cline-runtime-setup";

export interface ClineRuntimeSetupLease {
	setup: ClineRuntimeSetup;
	release: () => Promise<void>;
}

export interface ClineWatcherRegistry {
	acquire: (workspacePath: string) => Promise<ClineRuntimeSetupLease>;
	close: () => Promise<void>;
}

export interface CreateClineWatcherRegistryOptions {
	createRuntimeSetup?: (workspacePath: string) => Promise<ClineRuntimeSetup>;
}

interface RegistryEntry {
	refCount: number;
	setupPromise: Promise<ClineRuntimeSetup>;
}

export function createClineWatcherRegistry(options: CreateClineWatcherRegistryOptions = {}): ClineWatcherRegistry {
	const createRuntimeSetup = options.createRuntimeSetup ?? createClineRuntimeSetup;
	const entries = new Map<string, RegistryEntry>();

	const releaseWorkspace = async (workspacePath: string): Promise<void> => {
		const entry = entries.get(workspacePath);
		if (!entry) {
			return;
		}
		entry.refCount = Math.max(0, entry.refCount - 1);
		if (entry.refCount > 0) {
			return;
		}
		entries.delete(workspacePath);
		try {
			const setup = await entry.setupPromise;
			await setup.dispose();
		} catch {
			// Ignore runtime setup disposal failures.
		}
	};

	return {
		acquire: async (workspacePath) => {
			const normalizedWorkspacePath = workspacePath.trim();
			let entry = entries.get(normalizedWorkspacePath);
			if (!entry) {
				const setupPromise = createRuntimeSetup(normalizedWorkspacePath).catch((error) => {
					const current = entries.get(normalizedWorkspacePath);
					if (current?.setupPromise === setupPromise) {
						entries.delete(normalizedWorkspacePath);
					}
					throw error;
				});
				entry = {
					refCount: 0,
					setupPromise,
				};
				entries.set(normalizedWorkspacePath, entry);
			}
			entry.refCount += 1;
			return {
				setup: await entry.setupPromise,
				release: async () => {
					await releaseWorkspace(normalizedWorkspacePath);
				},
			};
		},
		close: async () => {
			const pendingDisposals = Array.from(entries.keys(), async (workspacePath) => {
				const entry = entries.get(workspacePath);
				if (!entry) {
					return;
				}
				entry.refCount = 1;
				await releaseWorkspace(workspacePath);
			});
			await Promise.all(pendingDisposals);
		},
	};
}
