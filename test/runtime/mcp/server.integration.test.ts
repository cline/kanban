import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import { createMcpServer } from "../../../src/mcp/server.js";
import { loadWorkspaceContext } from "../../../src/state/workspace-state.js";
import { createGitTestEnv } from "../../utilities/git-env.js";

function createTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function initGitRepository(cwd: string): void {
	const result = spawnSync("git", ["init"], {
		cwd,
		encoding: "utf8",
		env: createGitTestEnv(),
	});
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || "git init failed");
	}
}

async function withTemporaryHome<T>(fn: (homePath: string) => Promise<T>): Promise<T> {
	const previousHome = process.env.HOME;
	const temporaryHome = createTempDir("kanban-mcp-home-");
	process.env.HOME = temporaryHome;
	try {
		return await fn(temporaryHome);
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		rmSync(temporaryHome, { recursive: true, force: true });
	}
}

async function withConnectedMcpClient<T>(cwd: string, fn: (client: Client) => Promise<T>): Promise<T> {
	const server = createMcpServer(cwd);
	const client = new Client({
		name: "kanban-mcp-test-client",
		version: "1.0.0",
	});
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	try {
		return await fn(client);
	} finally {
		await client.close();
		await server.close();
	}
}

async function callToolJson(client: Client, name: string, args: Record<string, unknown>) {
	const rawResult = await client.callTool(
		{
			name,
			arguments: args,
		},
		CallToolResultSchema,
	);
	const result = CallToolResultSchema.parse(rawResult);
	const textContent = result.content.find((item) => item.type === "text");
	if (!textContent) {
		throw new Error("Expected text tool result content.");
	}
	const payload = JSON.parse(textContent.text) as { ok?: boolean; error?: string };
	return {
		result,
		payload,
	};
}

describe.sequential("mcp server integration", () => {
	it("returns structured create_task error when workspace resolution fails", async () => {
		await withTemporaryHome(async (homePath) => {
			const nonGitPath = join(homePath, "non-git-project");
			mkdirSync(nonGitPath, { recursive: true });

			await withConnectedMcpClient(homePath, async (client) => {
				const { result, payload } = await callToolJson(client, "create_task", {
					prompt: "test prompt",
					projectPath: nonGitPath,
				});

				expect(result.isError).toBe(true);
				expect(payload.ok).toBe(false);
				expect(payload.error).toContain('Tool "create_task"');
				expect(payload.error).toContain("No git repository detected");
			});
		});
	});

	it("returns structured start_task error when workspace resolution fails", async () => {
		await withTemporaryHome(async (homePath) => {
			const nonGitPath = join(homePath, "non-git-project");
			mkdirSync(nonGitPath, { recursive: true });

			await withConnectedMcpClient(homePath, async (client) => {
				const { result, payload } = await callToolJson(client, "start_task", {
					taskId: "task-123",
					projectPath: nonGitPath,
				});

				expect(result.isError).toBe(true);
				expect(payload.ok).toBe(false);
				expect(payload.error).toContain('Tool "start_task"');
				expect(payload.error).toContain("No git repository detected");
			});
		});
	});

	it("returns structured runtime error for list_tasks when runtime is unavailable", async () => {
		await withTemporaryHome(async (homePath) => {
			const repoPath = join(homePath, "repo");
			mkdirSync(repoPath, { recursive: true });
			initGitRepository(repoPath);
			await loadWorkspaceContext(repoPath);

			await withConnectedMcpClient(repoPath, async (client) => {
				const { result, payload } = await callToolJson(client, "list_tasks", {
					projectPath: repoPath,
				});

				expect(result.isError).toBe(true);
				expect(payload.ok).toBe(false);
				expect(payload.error).toContain('Tool "list_tasks"');
			});
		});
	});

	it("returns structured validation error for update_task when no fields are provided", async () => {
		await withTemporaryHome(async (homePath) => {
			await withConnectedMcpClient(homePath, async (client) => {
				const { result, payload } = await callToolJson(client, "update_task", {
					taskId: "task-123",
				});

				expect(result.isError).toBe(true);
				expect(payload.ok).toBe(false);
				expect(payload.error).toContain("update_task requires at least one field to change");
			});
		});
	});

	it("returns structured link_tasks error when workspace resolution fails", async () => {
		await withTemporaryHome(async (homePath) => {
			const nonGitPath = join(homePath, "non-git-project");
			mkdirSync(nonGitPath, { recursive: true });

			await withConnectedMcpClient(homePath, async (client) => {
				const { result, payload } = await callToolJson(client, "link_tasks", {
					taskId: "task-a",
					linkedTaskId: "task-b",
					projectPath: nonGitPath,
				});

				expect(result.isError).toBe(true);
				expect(payload.ok).toBe(false);
				expect(payload.error).toContain('Tool "link_tasks"');
				expect(payload.error).toContain("No git repository detected");
			});
		});
	});
});
