import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { RuntimeAgentId, RuntimeTaskStartSetupAvailability } from "../core/api-contract.js";
import { isBinaryAvailableOnPath } from "./command-discovery.js";
import { getOpenCodeConfigPathCandidates } from "./opencode-paths.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripJsonComments(input: string): string {
	let output = "";
	let inString = false;
	let escaped = false;
	let inLineComment = false;
	let inBlockComment = false;

	for (let index = 0; index < input.length; index += 1) {
		const current = input[index];
		const next = index + 1 < input.length ? input[index + 1] : "";

		if (inLineComment) {
			if (current === "\n") {
				inLineComment = false;
				output += current;
			}
			continue;
		}
		if (inBlockComment) {
			if (current === "*" && next === "/") {
				inBlockComment = false;
				index += 1;
			}
			continue;
		}
		if (!inString && current === "/" && next === "/") {
			inLineComment = true;
			index += 1;
			continue;
		}
		if (!inString && current === "/" && next === "*") {
			inBlockComment = true;
			index += 1;
			continue;
		}

		output += current;
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (current === "\\") {
				escaped = true;
			} else if (current === '"') {
				inString = false;
			}
			continue;
		}
		if (current === '"') {
			inString = true;
		}
	}

	return output;
}

function readFirstExistingFile(paths: string[]): string | null {
	for (const path of paths) {
		try {
			if (existsSync(path)) {
				return readFileSync(path, "utf8");
			}
		} catch {}
	}
	return null;
}

function parseJsonLike(raw: string | null): unknown {
	if (!raw) {
		return null;
	}
	try {
		return JSON.parse(raw);
	} catch {
		try {
			return JSON.parse(stripJsonComments(raw));
		} catch {
			return null;
		}
	}
}

function hasJsonObjectKey(raw: string | null, parentKey: string, childKey: string): boolean {
	const parsed = parseJsonLike(raw);
	if (!isRecord(parsed)) {
		return false;
	}
	const parent = parsed[parentKey];
	return isRecord(parent) && Object.hasOwn(parent, childKey);
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasCodexMcpServer(serverName: string): boolean {
	const raw = readFirstExistingFile([join(homedir(), ".codex", "config.toml")]);
	if (!raw) {
		return false;
	}
	const pattern = new RegExp(`^\\[mcp_servers\\.${escapeRegex(serverName)}\\]\\s*$`, "m");
	return pattern.test(raw);
}

function hasClaudeMcpServer(serverName: string): boolean {
	const parsed = parseJsonLike(readFirstExistingFile([join(homedir(), ".claude.json")]));
	if (!parsed) {
		return false;
	}

	const stack: unknown[] = [parsed];
	while (stack.length > 0) {
		const current = stack.pop();
		if (Array.isArray(current)) {
			stack.push(...current);
			continue;
		}
		if (!isRecord(current)) {
			continue;
		}
		const mcpServers = current.mcpServers;
		if (isRecord(mcpServers) && Object.hasOwn(mcpServers, serverName)) {
			return true;
		}
		stack.push(...Object.values(current));
	}

	return false;
}

function hasAgentMcpServer(agentId: RuntimeAgentId, serverName: "linear"): boolean {
	switch (agentId) {
		case "claude":
			return hasClaudeMcpServer(serverName);
		case "cline":
			return hasJsonObjectKey(
				readFirstExistingFile([join(homedir(), ".cline", "data", "settings", "cline_mcp_settings.json")]),
				"mcpServers",
				serverName,
			);
		case "codex":
			return hasCodexMcpServer(serverName);
		case "droid":
			return hasJsonObjectKey(
				readFirstExistingFile([join(homedir(), ".factory", "mcp.json")]),
				"mcpServers",
				serverName,
			);
		case "gemini":
			return hasJsonObjectKey(
				readFirstExistingFile([join(homedir(), ".gemini", "settings.json")]),
				"mcpServers",
				serverName,
			);
		case "opencode":
			return hasJsonObjectKey(readFirstExistingFile(getOpenCodeConfigPathCandidates()), "mcp", serverName);
		default:
			return false;
	}
}

export function detectTaskStartSetupAvailability(selectedAgentId: RuntimeAgentId): RuntimeTaskStartSetupAvailability {
	return {
		githubCli: isBinaryAvailableOnPath("gh"),
		linearMcp: hasAgentMcpServer(selectedAgentId, "linear"),
	};
}
