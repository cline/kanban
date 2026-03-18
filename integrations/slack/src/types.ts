/**
 * Persisted record for a user who has connected their Slack workspace.
 */
export interface SlackUserRecord {
  /** The Slack user ID (e.g. "U012AB3CD") of the bot installer. */
  slackUserId: string;
  /** The Slack team/workspace ID (e.g. "T012AB3CD"). */
  slackTeamId: string;
  /** The bot token obtained from the OAuth v2 exchange (starts with "xoxb-"). */
  accessToken: string;
  /** ISO 8601 timestamp of when this record was created/last updated. */
  registeredAt: string;
}

/**
 * Request body sent to the Slack App Server to register (or update)
 * a user after they complete the OAuth flow.
 */
export interface RegisterUserRequest {
  slackUserId: string;
  slackTeamId: string;
  /** Bot token obtained from Slack's OAuth v2 exchange. */
  accessToken: string;
}

/**
 * Response returned by the Slack App Server's user registration endpoint.
 */
export interface RegisterUserResponse {
  ok: boolean;
  error?: string;
}

/**
 * The relevant subset of the payload returned by Slack's OAuth v2 token
 * exchange endpoint (`oauth.v2.access`).
 *
 * @see https://api.slack.com/authentication/oauth-v2
 */
export interface OAuthCallbackPayload {
  /** The bot access token (starts with "xoxb-"). */
  access_token: string;
  /** The Slack workspace that installed the app. */
  team: {
    id: string;
  };
  /** The Slack user who authorized the installation. */
  authed_user: {
    id: string;
  };
}

/**
 * Authentication message sent by the local kanban client immediately after
 * opening a WebSocket connection to the slack-app-server `/connect` endpoint.
 */
export interface WsAuthMessage {
  type: "auth";
  /** The Slack user ID that uniquely identifies this kanban instance. */
  slackUserId: string;
  /** The bot access token obtained during the OAuth flow. */
  accessToken: string;
}

/**
 * Task payload pushed by the slack-app-server down the persistent WebSocket
 * connection whenever an @kanban mention is received in Slack.
 *
 * The local kanban client uses this payload to create a new task on the
 * user's kanban board via the local HTTP API.
 */
export interface TaskPayload {
  type: "task";
  /** The task description extracted from the Slack message. */
  prompt: string;
  /** The Slack channel the mention came from. */
  slackChannelId?: string;
  /** Thread timestamp, if the mention was posted inside a thread. */
  slackThreadTs?: string;
}

/**
 * A minimal task summary returned in list-tasks responses.
 * Mirrors {@link KanbanTask} from kanban-client.ts without the `baseRef` field.
 */
export interface KanbanTaskSummary {
  id: string;
  prompt: string;
  column: string;
}

/**
 * Sent by the server → client to request the user's current task list.
 * The client must reply with a matching {@link WsListTasksResponse}.
 */
export interface WsListTasksRequest {
  type: "list_tasks_request";
  /** Correlation ID so the server can match the response. */
  requestId: string;
  /** Optional column filter (omit to list all columns). */
  column?: "backlog" | "in_progress" | "review";
}

/**
 * Sent by the client → server in response to a {@link WsListTasksRequest}.
 */
export interface WsListTasksResponse {
  type: "list_tasks_response";
  /** Must match the `requestId` from the corresponding request. */
  requestId: string;
  tasks: KanbanTaskSummary[];
  /** Present when the local kanban API call failed. */
  error?: string;
}

/**
 * Union of all message types the server can send to the client.
 * Unknown future message types fall through to the `{ type: string }` branch.
 */
export type WsServerMessage = TaskPayload | WsListTasksRequest | { type: string };

/**
 * Union of all message types the client can send to the server.
 * The initial message after connecting must be {@link WsAuthMessage}.
 */
export type WsClientMessage = WsAuthMessage | WsListTasksResponse | { type: string };
