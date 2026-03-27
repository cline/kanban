// Fetches and caches the community prompts catalog from github.com/cline/prompts.
// Uses the Git Tree API (1 rate-limited call) to discover files, then fetches
// raw content from the CDN (not rate-limited) to parse YAML frontmatter.

import type { RuntimePromptItem, RuntimePromptType, RuntimePromptsCatalog } from "../core/api-contract.js";

const GITHUB_API_BASE = "https://api.github.com";
const RAW_CONTENT_BASE = "https://raw.githubusercontent.com/cline/prompts/main";
const REPO_OWNER = "cline";
const REPO_NAME = "prompts";

const DIRECTORY_TYPE_MAP: Record<string, RuntimePromptType> = {
	".clinerules/": "rule",
	"workflows/": "workflow",
};

const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Minimal YAML frontmatter parser
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): Record<string, unknown> {
	const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
	if (!match?.[1]) {
		return {};
	}

	const yamlBlock = match[1];
	const result: Record<string, unknown> = {};

	for (const line of yamlBlock.split("\n")) {
		const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
		if (!kvMatch) {
			continue;
		}

		const key = kvMatch[1]!;
		let value: unknown = kvMatch[2]!.trim();

		// Parse arrays like ["tag1", "tag2"]
		if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
			try {
				value = JSON.parse(value) as unknown;
			} catch {
				value = (value as string)
					.slice(1, -1)
					.split(",")
					.map((s: string) => s.trim().replace(/^["']|["']$/g, ""))
					.filter(Boolean);
			}
		}
		// Strip surrounding quotes
		else if (typeof value === "string" && /^["'].*["']$/.test(value)) {
			value = value.slice(1, -1);
		}

		result[key] = value;
	}

	return result;
}

// ---------------------------------------------------------------------------
// Author name resolution
// ---------------------------------------------------------------------------

function resolveAuthorName(author: string): string {
	try {
		const url = new URL(author.startsWith("http") ? author : `https://${author}`);
		if (url.hostname === "github.com" || url.hostname === "www.github.com") {
			const segments = url.pathname.split("/").filter(Boolean);
			if (segments.length > 0 && segments[0]) {
				return segments[0];
			}
		}
	} catch {
		// Not a URL, use as-is
	}
	return author;
}

// ---------------------------------------------------------------------------
// GitHub API types
// ---------------------------------------------------------------------------

interface GitTreeEntry {
	path: string;
	mode: string;
	type: string;
	sha: string;
	url: string;
}

interface GitTreeResponse {
	sha: string;
	url: string;
	tree: GitTreeEntry[];
	truncated: boolean;
}

interface GitCommitEntry {
	commit: {
		author: {
			date: string;
		};
	};
}

// ---------------------------------------------------------------------------
// Prompts Service
// ---------------------------------------------------------------------------

let cachedCatalog: RuntimePromptsCatalog | null = null;
let lastFetchTime = 0;

async function httpGetJson<T>(url: string): Promise<T> {
	const response = await fetch(url, {
		headers: {
			Accept: "application/vnd.github.v3+json",
		},
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) {
		throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
	}
	return (await response.json()) as T;
}

async function fetchRawContent(filePath: string): Promise<string> {
	const url = `${RAW_CONTENT_BASE}/${filePath}`;
	const response = await fetch(url, {
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) {
		throw new Error(`Failed to fetch raw content for ${filePath}: ${response.status}`);
	}
	return await response.text();
}

async function fetchLastCommitDate(filePath: string): Promise<string> {
	try {
		const url = `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/commits?path=${encodeURIComponent(filePath)}&per_page=1`;
		const commits = await httpGetJson<GitCommitEntry[]>(url);
		if (commits.length > 0 && commits[0]) {
			return commits[0].commit.author.date;
		}
	} catch {
		// Best effort — return empty string on failure
	}
	return "";
}

function processFileContent(
	filePath: string,
	content: string,
	lastCommitDate: string,
): RuntimePromptItem | null {
	let promptType: RuntimePromptType | null = null;
	for (const [prefix, type] of Object.entries(DIRECTORY_TYPE_MAP)) {
		if (filePath.startsWith(prefix)) {
			promptType = type;
			break;
		}
	}
	if (!promptType) {
		return null;
	}

	const frontmatter = parseFrontmatter(content);

	const fileName = filePath.split("/").pop() ?? "";
	const promptId = fileName.replace(/\.md$/, "");

	// Resolve author
	const fmAuthor = typeof frontmatter.author === "string" ? frontmatter.author.trim() : "";
	const authorName = fmAuthor ? resolveAuthorName(fmAuthor) : "Unknown";

	// Resolve version
	const version = frontmatter.version != null ? String(frontmatter.version).trim() : "";

	return {
		promptId,
		githubUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/main/${filePath}`,
		name: promptId
			.replace(/-/g, " ")
			.replace(/\b\w/g, (l: string) => l.toUpperCase()),
		author: authorName,
		description:
			typeof frontmatter.description === "string" && frontmatter.description.trim()
				? frontmatter.description.trim()
				: "No description available",
		category:
			typeof frontmatter.category === "string" && frontmatter.category.trim()
				? frontmatter.category.trim()
				: "General",
		tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [],
		type: promptType,
		content,
		version,
		globs: Array.isArray(frontmatter.globs) ? frontmatter.globs.map(String) : [],
		createdAt: lastCommitDate,
		updatedAt: lastCommitDate,
	};
}

export async function fetchPromptsCatalog(): Promise<RuntimePromptsCatalog> {
	const now = Date.now();
	if (cachedCatalog && now - lastFetchTime < CACHE_DURATION_MS) {
		return cachedCatalog;
	}

	try {
		// Step 1: Get all files via Git Tree API (single rate-limited call)
		const treeUrl = `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/main?recursive=1`;
		const treeResponse = await httpGetJson<GitTreeResponse>(treeUrl);
		const entries = treeResponse.tree ?? [];

		// Filter to markdown files in known directories
		const markdownFiles = entries.filter((entry) => {
			if (entry.type !== "blob" || !entry.path.toLowerCase().endsWith(".md")) {
				return false;
			}
			return Object.keys(DIRECTORY_TYPE_MAP).some((prefix) => entry.path.startsWith(prefix));
		});

		// Step 2: Fetch raw content + commit dates in parallel
		const items = await Promise.all(
			markdownFiles.map(async (entry) => {
				try {
					const [content, lastCommitDate] = await Promise.all([
						fetchRawContent(entry.path),
						fetchLastCommitDate(entry.path),
					]);
					return processFileContent(entry.path, content, lastCommitDate);
				} catch {
					return null;
				}
			}),
		);

		const catalog: RuntimePromptsCatalog = {
			items: items.filter((item): item is RuntimePromptItem => item !== null),
			lastUpdated: new Date().toISOString(),
		};

		cachedCatalog = catalog;
		lastFetchTime = now;

		return catalog;
	} catch {
		return {
			items: [],
			lastUpdated: new Date().toISOString(),
		};
	}
}

/** Visible for testing — resets the in-memory cache. */
export function resetPromptsCatalogCache(): void {
	cachedCatalog = null;
	lastFetchTime = 0;
}
