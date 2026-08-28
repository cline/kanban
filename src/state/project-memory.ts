import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { type LockRequest, lockedFileSystem } from "../fs/locked-file-system";

const PROJECT_MEMORY_FILENAME = "project-memory.md";
const PROJECT_MEMORY_MAX_CHARS = 10_000;

const projectMemoryContentSchema = z.string().max(PROJECT_MEMORY_MAX_CHARS, {
	message: `Project memory exceeds maximum size of ${PROJECT_MEMORY_MAX_CHARS} characters.`,
});

export type ProjectMemoryContent = z.infer<typeof projectMemoryContentSchema>;

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
	const normalized = normalizeProjectMemoryContent(content);
	const parsed = projectMemoryContentSchema.safeParse(normalized);
	if (!parsed.success) {
		const firstError = parsed.error.issues[0];
		return {
			type: "validation_error",
			message: firstError?.message ?? "Invalid project memory content.",
		};
	}
	return {
		type: "success",
		content: parsed.data,
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

export function getProjectMemoryMaxChars(): number {
	return PROJECT_MEMORY_MAX_CHARS;
}
