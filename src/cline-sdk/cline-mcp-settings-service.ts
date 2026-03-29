import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

import type { RuntimeClineMcpServer, RuntimeClineMcpSettingsResponse } from "../core/api-contract";
import { lockedFileSystem } from "../fs/locked-file-system";

const stringRecordSchema = z.record(z.string(), z.string());

// Matches Cline's flat server config schema.
// Servers with `command` are stdio; servers with `url` are sse or streamableHttp.
// `type` is optional on disk (Cline infers from fields), but we always resolve it on read.
const persistedServerBaseSchema = z.object({
	type: z.enum(["stdio", "sse", "streamableHttp"]).optional(),
	transportType: z.enum(["stdio", "sse", "http", "streamableHttp"]).optional(),
	disabled: z.boolean().optional(),
});

const persistedStdioServerSchema = persistedServerBaseSchema.extend({
	command: z.string().min(1),
	args: z.array(z.string()).optional(),
	cwd: z.string().min(1).optional(),
	env: stringRecordSchema.optional(),
});

const persistedUrlServerSchema = persistedServerBaseSchema.extend({
	url: z.string().url(),
	headers: stringRecordSchema.optional(),
});

const persistedServerSchema = z.union([persistedStdioServerSchema, persistedUrlServerSchema]);

const persistedSettingsSchema = z.object({
	mcpServers: z.record(z.string(), persistedServerSchema),
});

function resolveUrlServerType(raw: z.infer<typeof persistedUrlServerSchema>): "sse" | "streamableHttp" {
	if (raw.type === "streamableHttp" || raw.type === "sse") {
		return raw.type;
	}
	if (raw.transportType === "http" || raw.transportType === "streamableHttp") {
		return "streamableHttp";
	}
	if (raw.transportType === "sse") {
		return "sse";
	}
	// Default for url-based servers without explicit type (Cline's default for legacy configs)
	return "sse";
}

function normalizeRecord(record: Record<string, string> | undefined): Record<string, string> | undefined {
	if (!record) {
		return undefined;
	}
	const entries = Object.entries(record)
		.filter(([key, value]) => key.trim().length > 0 && value.trim().length > 0)
		.map(([key, value]) => [key.trim(), value.trim()] as const);
	if (entries.length === 0) {
		return undefined;
	}
	return Object.fromEntries(entries);
}

function normalizeServer(server: RuntimeClineMcpServer): RuntimeClineMcpServer {
	const name = server.name.trim();
	if (server.type === "stdio") {
		const args = server.args?.map((value) => value.trim()).filter((value) => value.length > 0);
		return {
			name,
			disabled: server.disabled,
			type: "stdio",
			command: server.command.trim(),
			args: args && args.length > 0 ? args : undefined,
			cwd: server.cwd?.trim() || undefined,
			env: normalizeRecord(server.env),
		};
	}

	return {
		name,
		disabled: server.disabled,
		type: server.type,
		url: server.url.trim(),
		headers: normalizeRecord(server.headers),
	};
}

function normalizeServers(servers: RuntimeClineMcpServer[]): RuntimeClineMcpServer[] {
	return servers.map(normalizeServer).sort((left, right) => left.name.localeCompare(right.name));
}

export function resolveMcpSettingsPath(): string {
	const configuredPath = process.env.CLINE_MCP_SETTINGS_PATH?.trim();
	if (configuredPath) {
		return resolve(configuredPath);
	}
	return join(homedir(), ".cline", "data", "settings", "cline_mcp_settings.json");
}

function parseSettingsFile(filePath: string): RuntimeClineMcpServer[] {
	if (!existsSync(filePath)) {
		return [];
	}

	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(readFileSync(filePath, "utf8"));
	} catch (error) {
		const details = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to parse MCP settings JSON at "${filePath}": ${details}`);
	}

	const parsed = persistedSettingsSchema.safeParse(parsedJson);
	if (!parsed.success) {
		const details = parsed.error.issues
			.map((issue) => {
				const path = issue.path.join(".");
				return path ? `${path}: ${issue.message}` : issue.message;
			})
			.join("; ");
		throw new Error(`Invalid MCP settings at "${filePath}": ${details}`);
	}

	const servers = Object.entries(parsed.data.mcpServers).map(([name, raw]): RuntimeClineMcpServer => {
		if ("command" in raw) {
			return {
				name,
				disabled: raw.disabled === true,
				type: "stdio",
				command: raw.command,
				args: raw.args,
				cwd: raw.cwd,
				env: raw.env,
			};
		}

		const resolvedType = resolveUrlServerType(raw);
		return {
			name,
			disabled: raw.disabled === true,
			type: resolvedType,
			url: raw.url,
			headers: raw.headers,
		};
	});

	return normalizeServers(servers);
}

export interface ClineMcpSettingsService {
	loadSettings(): RuntimeClineMcpSettingsResponse;
	saveSettings(input: { servers: RuntimeClineMcpServer[] }): Promise<RuntimeClineMcpSettingsResponse>;
}

export function createClineMcpSettingsService(): ClineMcpSettingsService {
	return {
		loadSettings(): RuntimeClineMcpSettingsResponse {
			const path = resolveMcpSettingsPath();
			return {
				path,
				servers: parseSettingsFile(path),
			};
		},

		async saveSettings(input: { servers: RuntimeClineMcpServer[] }): Promise<RuntimeClineMcpSettingsResponse> {
			const path = resolveMcpSettingsPath();
			const servers = normalizeServers(input.servers);
			const mcpServers = Object.fromEntries(
				servers.map((server) => {
					if (server.type === "stdio") {
						return [
							server.name,
							{
								type: "stdio" as const,
								command: server.command,
								...(server.args ? { args: server.args } : {}),
								...(server.cwd ? { cwd: server.cwd } : {}),
								...(server.env ? { env: server.env } : {}),
								...(server.disabled ? { disabled: true } : {}),
							},
						] as const;
					}

					return [
						server.name,
						{
							type: server.type,
							url: server.url,
							...(server.headers ? { headers: server.headers } : {}),
							...(server.disabled ? { disabled: true } : {}),
						},
					] as const;
				}),
			);

			await lockedFileSystem.writeJsonFileAtomic(
				path,
				{
					mcpServers,
				},
				{
					lock: {
						path,
						type: "file",
					},
				},
			);

			return {
				path,
				servers,
			};
		},
	};
}
