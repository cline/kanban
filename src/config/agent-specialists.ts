import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeAgentId } from "../core/api-contract";

/** A single user-defined specialist agent loaded from a .cline/agents/*.md file. */
export interface AgentSpecialist {
	/** Frontmatter `name` — used as agentId in team_spawn_teammate, e.g. "planner", "poet". */
	name: string;
	/** The underlying CLI agent that runs this specialist, e.g. "claude", "codex". */
	baseAgentId: RuntimeAgentId;
	/** Frontmatter `description` — human-readable description of this specialist's role. */
	description: string;
	/** Frontmatter `modelId` (optional) — model override to pass when spawning this specialist. */
	modelId?: string;
	/** Markdown body after the closing `---` (trimmed), omitted if empty. */
	instructions?: string;
}

/** Raw fields parsed from YAML frontmatter. */
interface RawFrontmatter {
	[key: string]: string;
}

/**
 * Parses Markdown+YAML frontmatter from a file's text content.
 * Returns null if the file does not start with `---\n` or has no closing `---`.
 * The YAML block is parsed line-by-line; only simple `key: value` pairs are supported.
 */
function parseFrontmatter(content: string): { frontmatter: RawFrontmatter; body: string } | null {
	// Must start with ---\n
	if (!content.startsWith("---\n")) {
		return null;
	}

	// Find the closing --- line (starting from position 4, after opening ---)
	const rest = content.slice(4);
	const closingIndex = rest.indexOf("\n---\n");
	const closingAtEnd = rest.endsWith("\n---");
	if (closingIndex === -1 && !closingAtEnd) {
		return null;
	}

	const yamlBlock = closingIndex !== -1 ? rest.slice(0, closingIndex) : rest.slice(0, rest.length - 4);
	const bodyStart = closingIndex !== -1 ? closingIndex + 5 /* \n---\n */ : rest.length;
	const body = rest.slice(bodyStart).trim();

	// Parse YAML line by line: only handle `key: value` pairs
	const frontmatter: RawFrontmatter = {};
	for (const line of yamlBlock.split("\n")) {
		const match = /^(\w+):\s*(.*)$/.exec(line);
		if (match) {
			const key = match[1] ?? "";
			const value = match[2] ?? "";
			frontmatter[key] = value;
		}
	}

	return { frontmatter, body };
}

/** Validates parsed frontmatter fields and returns an AgentSpecialist or null. */
function validateSpecialist(frontmatter: RawFrontmatter, body: string): AgentSpecialist | null {
	const name = frontmatter.name?.trim() ?? "";
	const baseAgentId = frontmatter.baseAgentId?.trim() ?? "";
	const description = frontmatter.description?.trim() ?? "";
	const rawModelId = frontmatter.modelId;

	// name, baseAgentId, description must be non-empty
	if (!name || !baseAgentId || !description) {
		return null;
	}

	// modelId: if present in frontmatter, must be non-empty after trim
	if (rawModelId !== undefined) {
		if (rawModelId.trim().length === 0) {
			return null;
		}
	}

	const specialist: AgentSpecialist = {
		name,
		baseAgentId: baseAgentId as RuntimeAgentId,
		description,
	};

	if (rawModelId !== undefined) {
		specialist.modelId = rawModelId.trim();
	}

	const trimmedBody = body.trim();
	if (trimmedBody.length > 0) {
		specialist.instructions = trimmedBody;
	}

	return specialist;
}

/**
 * Loads custom agent specialists from .cline/agents/*.md in the given project root.
 * Returns an empty array if the directory does not exist or contains no valid .md files.
 * Uses synchronous I/O so it can be called inline during prompt rendering.
 */
export function loadAgentSpecialists(projectRoot: string): AgentSpecialist[] {
	const agentsDir = join(projectRoot, ".cline", "agents");
	let files: string[];
	try {
		files = readdirSync(agentsDir);
	} catch {
		// Directory does not exist — silently return empty.
		return [];
	}

	const specialists: AgentSpecialist[] = [];

	for (const file of files) {
		// Only process .md files
		if (!file.endsWith(".md")) {
			continue;
		}
		try {
			const content = readFileSync(join(agentsDir, file), "utf-8");
			const parsed = parseFrontmatter(content);
			if (!parsed) {
				continue;
			}
			const specialist = validateSpecialist(parsed.frontmatter, parsed.body);
			if (specialist) {
				specialists.push(specialist);
			}
		} catch {
			// File unreadable — skip silently.
		}
	}

	return specialists;
}
