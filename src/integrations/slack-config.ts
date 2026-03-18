// Persists Slack integration credentials and board config to ~/.kanban/integrations/slack.json.
// Written by the kanban runtime after the Slack OAuth callback, read by the Slack ws-client.
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const SLACK_CONFIG_PATH = join(homedir(), ".kanban", "integrations", "slack.json");

const slackConfigSchema = z.object({
	/** The Slack user ID (e.g. "U012AB3CD"). Provided by the OAuth server callback. */
	slackUserId: z.string().min(1),
	/** The bot access token (starts with "xoxb-"). Provided by the OAuth server callback. */
	accessToken: z.string().min(1),
	/** The kanban workspace ID where incoming Slack tasks should be created. */
	workspaceId: z.string().min(1),
	/** The kanban runtime URL (e.g. "http://127.0.0.1:3484"). Recorded at connect time. */
	kanbanUrl: z.string().min(1),
	/** ISO 8601 timestamp of when this config was written. */
	connectedAt: z.string(),
});

export type SlackConfig = z.infer<typeof slackConfigSchema>;

export function getSlackConfigPath(): string {
	return SLACK_CONFIG_PATH;
}

export async function loadSlackConfig(): Promise<SlackConfig | null> {
	try {
		const raw = await readFile(SLACK_CONFIG_PATH, "utf-8");
		const result = slackConfigSchema.safeParse(JSON.parse(raw));
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

export async function deleteSlackConfig(): Promise<void> {
	try {
		await unlink(SLACK_CONFIG_PATH);
	} catch (err) {
		// Ignore ENOENT — config already absent is a success.
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			throw err;
		}
	}
}

export async function saveSlackConfig(config: Omit<SlackConfig, "connectedAt">): Promise<SlackConfig> {
	await mkdir(join(homedir(), ".kanban", "integrations"), { recursive: true });
	const full: SlackConfig = {
		...config,
		connectedAt: new Date().toISOString(),
	};
	await writeFile(SLACK_CONFIG_PATH, JSON.stringify(full, null, 2), "utf-8");
	return full;
}
