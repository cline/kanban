export const WORKTREE_ALLOWLIST_FILENAME = ".kanban-worktree-allowlist";
export const DEFAULT_WORKTREE_SHARED_DIRECTORIES = ["node_modules"] as const;
export const WORKTREE_ALLOWLIST_MAX_BYTES = 64 * 1024;
export const WORKTREE_ALLOWLIST_MAX_ENTRIES = 256;

const CREDENTIAL_BASENAMES = new Set([
	".env",
	".envrc",
	".npmrc",
	".pypirc",
	".netrc",
	".git-credentials",
	"id_rsa",
	"id_dsa",
	"id_ecdsa",
	"id_ed25519",
	"credentials.json",
	"credentials.yml",
	"credentials.yaml",
	"auth.json",
	"secrets.json",
	"service-account.json",
]);

export interface WorktreeAllowlistParseResult {
	paths: string[];
	rejected: string[];
}

export interface WorktreeProvisionSelection {
	allowlistedPaths: readonly string[];
	sharedDirectories: readonly string[];
}

export function toWorktreeRelativePath(path: string): string {
	return path
		.trim()
		.replaceAll("\\", "/")
		.replace(/\/+$/g, "")
		.split("/")
		.filter((segment) => segment.length > 0)
		.join("/");
}

function isGlobPattern(path: string): boolean {
	return /[*?[]/.test(path);
}

function isUnsafeRelativePath(path: string): boolean {
	if (!path) {
		return true;
	}
	if (path.startsWith("/") || path.startsWith("~") || /^[A-Za-z]:/.test(path)) {
		return true;
	}
	return path.split("/").some((segment) => segment === "." || segment === "..");
}

function getPathBasename(relativePath: string): string {
	const segments = relativePath.split("/").filter((segment) => segment.length > 0);
	return segments.at(-1) ?? "";
}

export function isCredentialRelativePath(relativePath: string): boolean {
	const normalized = toWorktreeRelativePath(relativePath);
	if (!normalized) {
		return false;
	}

	return normalized.split("/").some((segment) => {
		if (CREDENTIAL_BASENAMES.has(segment)) {
			return true;
		}
		return segment.startsWith(".env.");
	});
}

export function listContainsCredentialBasename(names: readonly string[]): string[] {
	const found: string[] = [];
	const seen = new Set<string>();
	for (const name of names) {
		const basename = toWorktreeRelativePath(name).split("/")[0] ?? "";
		if (!basename || seen.has(basename) || !isCredentialRelativePath(basename)) {
			continue;
		}
		seen.add(basename);
		found.push(basename);
	}
	return found;
}

export function parseWorktreeAllowlistFile(
	content: string,
	byteLength = Buffer.byteLength(content),
): WorktreeAllowlistParseResult {
	if (byteLength > WORKTREE_ALLOWLIST_MAX_BYTES) {
		return {
			paths: [],
			rejected: [`${WORKTREE_ALLOWLIST_FILENAME} exceeds the ${String(WORKTREE_ALLOWLIST_MAX_BYTES)} byte size cap`],
		};
	}

	const paths: string[] = [];
	const rejected: string[] = [];
	const seen = new Set<string>();

	for (const rawLine of content.split(/\r?\n/u)) {
		const trimmed = rawLine.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}

		const normalized = toWorktreeRelativePath(trimmed);
		if (!normalized || isUnsafeRelativePath(normalized) || isGlobPattern(trimmed) || isGlobPattern(normalized)) {
			rejected.push(trimmed);
			continue;
		}

		if (seen.has(normalized)) {
			continue;
		}
		if (paths.length >= WORKTREE_ALLOWLIST_MAX_ENTRIES) {
			rejected.push(trimmed);
			continue;
		}

		seen.add(normalized);
		paths.push(normalized);
	}

	return { paths, rejected };
}

export function normalizeWorktreeSharedDirectories(value: unknown): string[] | null {
	if (!Array.isArray(value)) {
		return null;
	}

	const directories: string[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		if (typeof entry !== "string") {
			continue;
		}
		const normalized = toWorktreeRelativePath(entry);
		if (!normalized || isUnsafeRelativePath(normalized) || isGlobPattern(entry) || isGlobPattern(normalized)) {
			continue;
		}
		if (isCredentialRelativePath(normalized)) {
			continue;
		}
		if (seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		directories.push(normalized);
	}
	return directories;
}

function matchesSharedDirectory(relativePath: string, sharedDirectory: string): boolean {
	if (relativePath === sharedDirectory) {
		return true;
	}
	if (sharedDirectory.includes("/")) {
		return relativePath.startsWith(`${sharedDirectory}/`);
	}
	return getPathBasename(relativePath) === sharedDirectory;
}

export function shouldProvisionIgnoredPath(relativePath: string, selection: WorktreeProvisionSelection): boolean {
	const normalized = toWorktreeRelativePath(relativePath);
	if (!normalized) {
		return false;
	}

	const allowlisted = new Set(selection.allowlistedPaths.map((path) => toWorktreeRelativePath(path)).filter(Boolean));
	if (allowlisted.has(normalized)) {
		return true;
	}

	if (isCredentialRelativePath(normalized)) {
		return false;
	}

	return selection.sharedDirectories.some((directory) => {
		const normalizedDirectory = toWorktreeRelativePath(directory);
		if (!normalizedDirectory || isCredentialRelativePath(normalizedDirectory) || isGlobPattern(normalizedDirectory)) {
			return false;
		}
		return matchesSharedDirectory(normalized, normalizedDirectory);
	});
}

export function selectIgnoredPathsToProvision(
	ignoredPaths: readonly string[],
	selection: WorktreeProvisionSelection,
): string[] {
	return ignoredPaths.filter((relativePath) => shouldProvisionIgnoredPath(relativePath, selection));
}

export function formatUnprovisionedIgnoredPathWarning(relativePaths: readonly string[]): string | null {
	const uniquePaths = [...new Set(relativePaths.map((path) => toWorktreeRelativePath(path)).filter(Boolean))];
	if (uniquePaths.length === 0) {
		return null;
	}

	const namedPaths = uniquePaths.slice(0, 5);
	const extraCount = uniquePaths.length - namedPaths.length;
	const pathList = namedPaths.map((path) => `"${path}"`).join(", ");
	const extra = extraCount > 0 ? ` (and ${String(extraCount)} more)` : "";

	return `Ignored path ${pathList}${extra} exists in the primary checkout but was not provisioned into the task worktree. Add the literal relative path to ${WORKTREE_ALLOWLIST_FILENAME} at the repository root to provision it.`;
}

export function formatSharedDirectoryCredentialWarning(
	relativePath: string,
	credentialNames: readonly string[],
): string | null {
	const directory = toWorktreeRelativePath(relativePath);
	const names = listContainsCredentialBasename(credentialNames);
	if (!directory || names.length === 0) {
		return null;
	}
	const named = names.map((name) => `"${name}"`).join(", ");
	return `Shared directory "${directory}" was not provisioned because it contains ${named}. Do not share a directory that holds secrets.`;
}
