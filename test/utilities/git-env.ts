export function createGitTestEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	const sanitized: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) {
		// Hooks can export GIT_* vars that redirect git commands away from test cwd.
		if (key.startsWith("GIT_")) {
			continue;
		}
		sanitized[key] = value;
	}
	return {
		...sanitized,
		GIT_AUTHOR_NAME: "Test",
		GIT_AUTHOR_EMAIL: "test@test.com",
		GIT_COMMITTER_NAME: "Test",
		GIT_COMMITTER_EMAIL: "test@test.com",
		...overrides,
	};
}
