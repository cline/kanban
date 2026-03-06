const GIT_REPOSITORY_ENV_KEYS = new Set([
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_COMMON_DIR",
	"GIT_INDEX_FILE",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_PREFIX",
]);

export function createGitProcessEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	const sanitized: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) {
		// Prevent parent git hook context from hijacking repository-scoped git commands.
		if (GIT_REPOSITORY_ENV_KEYS.has(key)) {
			continue;
		}
		sanitized[key] = value;
	}
	return {
		...sanitized,
		...overrides,
	};
}
