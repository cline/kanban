import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { RuntimeSlashCommand } from "../core/api-contract";

const SKILL_ROOTS = [".cline/skills", ".cursor/skills", ".agents/skills"] as const;
const SKIP_DIR_NAMES = new Set([".git", "node_modules"]);

function stripQuotes(val: string): string {
	let trimmed = val.trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		trimmed = trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

function parseSkillFrontmatter(content: string, skillMdPath: string): { name: string; description: string } | null {
	if (!content.startsWith("---")) {
		return null;
	}
	const rest = content.slice(3);
	const endIndex = rest.indexOf("\n---");
	if (endIndex < 0) {
		return null;
	}
	const frontmatter = rest.slice(0, endIndex);

	const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
	if (!descMatch) {
		return null;
	}
	const description = stripQuotes(descMatch[1]);
	if (!description) {
		return null;
	}

	const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
	const folderName = basename(dirname(skillMdPath));
	const name = nameMatch ? stripQuotes(nameMatch[1]) || folderName : folderName;

	return { name, description };
}

function findSkillMdFiles(dir: string): string[] {
	const results: string[] = [];
	if (!existsSync(dir)) {
		return results;
	}

	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		entries.sort((a, b) => a.name.localeCompare(b.name));

		for (const entry of entries) {
			if (SKIP_DIR_NAMES.has(entry.name)) {
				continue;
			}
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				results.push(...findSkillMdFiles(fullPath));
			} else if (entry.isFile() && entry.name === "SKILL.md") {
				results.push(fullPath);
			}
		}
	} catch {
		// Ignore filesystem errors during walk
	}

	return results;
}

export function listProjectSkillSlashCommands(root: string): RuntimeSlashCommand[] {
	const commands: RuntimeSlashCommand[] = [];
	const seen = new Set<string>();

	for (const relDir of SKILL_ROOTS) {
		const baseDir = join(root, relDir);
		const skillFiles = findSkillMdFiles(baseDir);

		for (const skillMdPath of skillFiles) {
			try {
				const content = readFileSync(skillMdPath, "utf8");
				const parsed = parseSkillFrontmatter(content, skillMdPath);
				if (!parsed) {
					continue;
				}
				if (seen.has(parsed.name)) {
					continue;
				}
				seen.add(parsed.name);
				commands.push({
					name: parsed.name,
					instructions: "",
					description: parsed.description,
				});
			} catch {
				// Ignore read errors
			}
		}
	}

	return commands;
}
