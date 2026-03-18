// Reads the Slack integration config written by the kanban runtime after OAuth.
// Config is stored at ~/.kanban/integrations/slack.json.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const SLACK_CONFIG_PATH = join(homedir(), ".kanban", "integrations", "slack.json");

export interface SlackConfig {
	slackUserId: string;
	accessToken: string;
	workspaceId: string;
	kanbanUrl: string;
	connectedAt: string;
}

export function getSlackConfigPath(): string {
	return SLACK_CONFIG_PATH;
}

export async function loadSlackConfig(): Promise<SlackConfig | null> {
	try {
		const raw = await readFile(SLACK_CONFIG_PATH, "utf-8");
		return JSON.parse(raw) as SlackConfig;
	} catch {
		return null;
	}
}
