import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { type LockRequest, lockedFileSystem } from "../fs/locked-file-system";

const PROJECT_MEMORY_FILENAME = "project-memory.md";
export type ProjectMemoryContent = string;

export interface ProjectMemoryValidationError {
	type: "validation_error";
	message: string;
}

export interface ProjectMemorySuccess {
	type: "success";
	content: ProjectMemoryContent;
}

export type ProjectMemoryReadResult = ProjectMemorySuccess | ProjectMemoryValidationError;

export interface ProjectMemoryWriteSuccess {
	type: "success";
	content: ProjectMemoryContent;
}

export interface ProjectMemoryWriteError {
	type: "write_error";
	message: string;
}

export type ProjectMemoryWriteResult =
	| ProjectMemoryWriteSuccess
	| ProjectMemoryWriteError
	| ProjectMemoryValidationError;

function getProjectMemoryPath(workspaceId: string): string {
	return join(getProjectMemoryRoot(workspaceId), PROJECT_MEMORY_FILENAME);
}

function getProjectMemoryRoot(workspaceId: string): string {
	return join(homedir(), ".cline", "kanban", "workspaces", workspaceId);
}

function getProjectMemoryLockRequest(workspaceId: string): LockRequest {
	return {
		path: getProjectMemoryRoot(workspaceId),
		type: "directory",
	};
}

async function readProjectMemoryFile(workspaceId: string): Promise<string> {
	try {
		return await readFile(getProjectMemoryPath(workspaceId), "utf8");
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return "";
		}
		throw error;
	}
}
export function normalizeProjectMemoryContent(content: string): string {
	return content.replace(/\r\n/g, "\n").trim();
}

export function validateProjectMemoryContent(content: string): ProjectMemoryReadResult {
	return {
		type: "success",
		content: normalizeProjectMemoryContent(content),
	};
}

export async function readProjectMemory(workspaceId: string): Promise<ProjectMemoryReadResult> {
	try {
		const rawContent = await lockedFileSystem.withLock(getProjectMemoryLockRequest(workspaceId), async () =>
			readProjectMemoryFile(workspaceId),
		);

		return validateProjectMemoryContent(rawContent);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			type: "validation_error",
			message: `Failed to read project memory: ${message}`,
		};
	}
}
export async function writeProjectMemory(workspaceId: string, content: string): Promise<ProjectMemoryWriteResult> {
	return await updateProjectMemory(workspaceId, () => content);
}

export async function updateProjectMemory(
	workspaceId: string,
	update: (currentContent: string) => string,
): Promise<ProjectMemoryWriteResult> {
	try {
		return await lockedFileSystem.withLock(getProjectMemoryLockRequest(workspaceId), async () => {
			const currentResult = validateProjectMemoryContent(await readProjectMemoryFile(workspaceId));
			if (currentResult.type === "validation_error") {
				return currentResult;
			}
			const nextResult = validateProjectMemoryContent(update(currentResult.content));
			if (nextResult.type === "validation_error") {
				return nextResult;
			}
			await lockedFileSystem.writeTextFileAtomic(getProjectMemoryPath(workspaceId), nextResult.content, {
				lock: null,
			});
			return {
				type: "success",
				content: nextResult.content,
			};
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			type: "write_error",
			message: `Failed to write project memory: ${message}`,
		};
	}
}
