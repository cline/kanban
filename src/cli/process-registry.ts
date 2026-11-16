import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type LockRequest, lockedFileSystem } from "../fs/locked-file-system";
import type { NormalizedLaunchOptions } from "./launch-options";

export type ManagedProcessMode = "foreground" | "background";

export interface ManagedProcessLaunch {
	host: string;
	port: number;
	open: boolean;
	skipShutdownCleanup: boolean;
	https: boolean;
	cert: string | null;
	key: string | null;
	noPasscode: boolean;
	agent: string | null;
}

export interface ManagedProcessRecord {
	pid: number;
	host: string;
	port: number;
	endpoint: string;
	startedAt: string;
	mode: ManagedProcessMode;
	cwd: string;
	logFile: string | null;
	launchArgs: string[];
	launch: ManagedProcessLaunch;
}

interface ProcessRegistryFile {
	version: 1;
	processes: ManagedProcessRecord[];
}

const REGISTRY_DIRECTORY = join(homedir(), ".cline", "kanban");
const REGISTRY_PATH = join(REGISTRY_DIRECTORY, "processes.json");
const REGISTRY_LOCK: LockRequest = { path: REGISTRY_PATH, type: "file" };

export function getProcessRegistryPath(): string {
	return REGISTRY_PATH;
}

async function readRegistryFile(): Promise<ManagedProcessRecord[]> {
	try {
		const raw = await readFile(REGISTRY_PATH, "utf8");
		const parsed = JSON.parse(raw) as Partial<ProcessRegistryFile>;
		if (parsed.version !== 1 || !Array.isArray(parsed.processes)) {
			return [];
		}
		return parsed.processes.filter((record): record is ManagedProcessRecord => isManagedProcessRecord(record));
	} catch (error) {
		if (isMissingFileError(error)) {
			return [];
		}
		if (error instanceof SyntaxError) {
			return [];
		}
		throw error;
	}
}

function isMissingFileError(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isManagedProcessRecord(value: unknown): value is ManagedProcessRecord {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Partial<ManagedProcessRecord>;
	return (
		typeof record.pid === "number" &&
		record.pid > 0 &&
		typeof record.host === "string" &&
		typeof record.port === "number" &&
		typeof record.endpoint === "string" &&
		typeof record.startedAt === "string" &&
		(record.mode === "foreground" || record.mode === "background") &&
		typeof record.cwd === "string" &&
		(record.logFile === null || typeof record.logFile === "string") &&
		Array.isArray(record.launchArgs) &&
		record.launchArgs.every((argument) => typeof argument === "string") &&
		!!record.launch
	);
}

async function writeRegistryFile(processes: readonly ManagedProcessRecord[]): Promise<void> {
	await lockedFileSystem.writeJsonFileAtomic(
		REGISTRY_PATH,
		{
			version: 1,
			processes: [...processes],
		} satisfies ProcessRegistryFile,
		{ lock: null },
	);
}

export async function listManagedProcesses(): Promise<ManagedProcessRecord[]> {
	return await lockedFileSystem.withLock(REGISTRY_LOCK, async () => await readRegistryFile());
}

export async function registerManagedProcess(record: ManagedProcessRecord): Promise<void> {
	await lockedFileSystem.withLock(REGISTRY_LOCK, async () => {
		const processes = (await readRegistryFile()).filter((existing) => existing.pid !== record.pid);
		processes.push(record);
		await writeRegistryFile(processes);
	});
}

export async function unregisterManagedProcess(pid: number): Promise<void> {
	await lockedFileSystem.withLock(REGISTRY_LOCK, async () => {
		const processes = (await readRegistryFile()).filter((record) => record.pid !== pid);
		await writeRegistryFile(processes);
	});
}

export async function replaceManagedProcesses(processes: readonly ManagedProcessRecord[]): Promise<void> {
	await lockedFileSystem.withLock(REGISTRY_LOCK, async () => {
		await writeRegistryFile(processes);
	});
}

export function createManagedProcessLaunch(
	options: NormalizedLaunchOptions,
	actualPort: number,
	actualHost: string,
): ManagedProcessLaunch {
	return {
		host: actualHost,
		port: actualPort,
		open: options.open,
		skipShutdownCleanup: options.skipShutdownCleanup,
		https: options.https || options.cert !== null || options.key !== null,
		cert: options.cert,
		key: options.key,
		noPasscode: options.noPasscode,
		agent: options.agent,
	};
}
