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
		// Test repos must not inherit global commit/tag signing: signing agents
		// refuse or hang on non-interactive spawns.
		GIT_CONFIG_COUNT: "2",
		GIT_CONFIG_KEY_0: "commit.gpgsign",
		GIT_CONFIG_VALUE_0: "false",
		GIT_CONFIG_KEY_1: "tag.gpgsign",
		GIT_CONFIG_VALUE_1: "false",
		...overrides,
	};
}
