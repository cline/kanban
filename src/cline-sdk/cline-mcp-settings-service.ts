import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

import type {
	RuntimeClineMcpServer,
	RuntimeClineMcpSettingsResponse,
} from "../core/api-contract.js";
import { lockedFileSystem } from "../fs/locked-file-system.js";

const stringRecordSchema = z.record(z.string(), z.string());

const persistedStdioTransportSchema = z.object({
	type: z.literal("stdio"),
	command: z.string().min(1),
	args: z.array(z.string()).optional(),
	cwd: z.string().min(1).optional(),
	env: stringRecordSchema.optional(),
});

const persistedSseTransportSchema = z.object({
	type: z.literal("sse"),
	url: z.string().url(),
	headers: stringRecordSchema.optional(),
});

const persistedStreamableHttpTransportSchema = z.object({
	type: z.literal("streamableHttp"),
	url: z.string().url(),
	headers: stringRecordSchema.optional(),
});

const persistedTransportSchema = z.discriminatedUnion("type", [
	persistedStdioTransportSchema,
	persistedSseTransportSchema,
	persistedStreamableHttpTransportSchema,
]);

const persistedNestedServerSchema = z.object({
	transport: persistedTransportSchema,
	disabled: z.boolean().optional(),
});

const legacyTransportTypeSchema = z.enum(["stdio", "sse", "http", "streamableHttp"]).optional();

function mapLegacyTransportType(
	transportType: z.infer<typeof legacyTransportTypeSchema>,
): "stdio" | "sse" | "streamableHttp" | undefined {
	if (!transportType) {
		return undefined;
	}
	if (transportType === "http") {
		return "streamableHttp";
	}
	return transportType;
}

const legacyServerBaseSchema = z.object({
	type: z.enum(["stdio", "sse", "streamableHttp"]).optional(),
	transportType: legacyTransportTypeSchema,
	disabled: z.boolean().optional(),
});

const legacyStdioServerSchema = legacyServerBaseSchema
	.extend({
		command: z.string().min(1),
		args: z.array(z.string()).optional(),
		cwd: z.string().min(1).optional(),
		env: stringRecordSchema.optional(),
	})
	.transform((value) => ({
		transport: {
			type: "stdio" as const,
			command: value.command,
			args: value.args,
			cwd: value.cwd,
			env: value.env,
		},
		disabled: value.disabled,
	}));

const legacyUrlServerSchema = legacyServerBaseSchema
	.extend({
		url: z.string().url(),
		headers: stringRecordSchema.optional(),
	})
	.transform((value) => {
		const resolvedType = value.type ?? mapLegacyTransportType(value.transportType) ?? "sse";
		if (resolvedType === "streamableHttp") {
			return {
				transport: {
					type: "streamableHttp" as const,
					url: value.url,
					headers: value.headers,
				},
				disabled: value.disabled,
			};
		}
		return {
			transport: {
				type: "sse" as const,
				url: value.url,
				headers: value.headers,
			},
			disabled: value.disabled,
		};
	});

const persistedServerSchema = z.union([
	persistedNestedServerSchema,
	legacyStdioServerSchema,
	legacyUrlServerSchema,
]);

const persistedSettingsSchema = z
	.object({
		mcpServers: z.record(z.string(), persistedServerSchema),
	})
	.strict();

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
	if (server.transport.type === "stdio") {
		const args = server.transport.args?.map((value) => value.trim()).filter((value) => value.length > 0);
		return {
			name,
			disabled: server.disabled,
			transport: {
				type: "stdio",
				command: server.transport.command.trim(),
				args: args && args.length > 0 ? args : undefined,
				cwd: server.transport.cwd?.trim() || undefined,
				env: normalizeRecord(server.transport.env),
			},
		};
	}

	return {
		name,
		disabled: server.disabled,
		transport: {
			type: server.transport.type,
			url: server.transport.url.trim(),
			headers: normalizeRecord(server.transport.headers),
		},
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

	const servers = Object.entries(parsed.data.mcpServers).map(([name, value]) => {
		if (value.transport.type === "stdio") {
			return {
				name,
				disabled: value.disabled === true,
				transport: {
					type: "stdio" as const,
					command: value.transport.command,
					args: value.transport.args,
					cwd: value.transport.cwd,
					env: value.transport.env,
				},
			} satisfies RuntimeClineMcpServer;
		}

		if (value.transport.type === "sse") {
			return {
				name,
				disabled: value.disabled === true,
				transport: {
					type: "sse" as const,
					url: value.transport.url,
					headers: value.transport.headers,
				},
			} satisfies RuntimeClineMcpServer;
		}

		return {
			name,
			disabled: value.disabled === true,
			transport: {
				type: "streamableHttp" as const,
				url: value.transport.url,
				headers: value.transport.headers,
			},
		} satisfies RuntimeClineMcpServer;
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

		async saveSettings(input: {
			servers: RuntimeClineMcpServer[];
		}): Promise<RuntimeClineMcpSettingsResponse> {
			const path = resolveMcpSettingsPath();
			const servers = normalizeServers(input.servers);
			const mcpServers = Object.fromEntries(
				servers.map((server) => {
					if (server.transport.type === "stdio") {
						return [
							server.name,
							{
								transport: {
									type: "stdio" as const,
									command: server.transport.command,
									...(server.transport.args ? { args: server.transport.args } : {}),
									...(server.transport.cwd ? { cwd: server.transport.cwd } : {}),
									...(server.transport.env ? { env: server.transport.env } : {}),
								},
								...(server.disabled ? { disabled: true } : {}),
							},
						] as const;
					}

					return [
						server.name,
						{
							transport: {
								type: server.transport.type,
								url: server.transport.url,
								...(server.transport.headers ? { headers: server.transport.headers } : {}),
							},
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
