import WebSocket from "ws";
import type { RawData } from "ws";
import { createTask, listTasks } from "./kanban-client.js";
import type {
  KanbanTaskSummary,
  TaskPayload,
  WsAuthMessage,
  WsListTasksRequest,
  WsListTasksResponse,
  WsServerMessage,
} from "./types.js";

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const BACKOFF_MULTIPLIER = 2;

/** Per-user kanban instance config: which server to call and which workspace to use. */
interface UserConfig {
  kanbanUrl: string;
  workspaceId: string;
}

export interface SlackWsClientConfig {
  /**
   * Full WebSocket URL of the slack-app-server connect endpoint.
   * Example: `wss://your-server.example.com/connect`
   */
  serverWsUrl: string;
  /** The Slack user ID that authenticates this connection (e.g. "U012AB3CD"). */
  slackUserId: string;
  /** The bot access token obtained during the OAuth flow (starts with "xoxb-"). */
  accessToken: string;
  /** Per-user kanban instance config: which server to call and which workspace to use. */
  userConfig: UserConfig;
}

function isTaskPayload(msg: WsServerMessage): msg is TaskPayload {
  return (
    msg.type === "task" &&
    typeof (msg as TaskPayload).prompt === "string" &&
    (msg as TaskPayload).prompt.length > 0
  );
}

function isListTasksRequest(msg: WsServerMessage): msg is WsListTasksRequest {
  return (
    msg.type === "list_tasks_request" &&
    typeof (msg as WsListTasksRequest).requestId === "string"
  );
}

/**
 * Start a persistent WebSocket client that receives task payloads from the
 * slack-app-server and creates tasks on the local kanban board.
 *
 * The client reconnects automatically on disconnection using exponential
 * backoff with ±10 % jitter (starting at 1 s, capped at 60 s).
 *
 * @returns A cleanup function. Call it to close the connection and stop
 *          any pending reconnection attempt.
 *
 * @example
 * ```ts
 * const stop = startSlackClient({ serverWsUrl, slackUserId, accessToken, userConfig });
 * process.on("SIGTERM", stop);
 * ```
 */
export function startSlackClient(config: SlackWsClientConfig): () => void {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = INITIAL_BACKOFF_MS;
  let stopped = false;

  function scheduleReconnect(): void {
    if (stopped) return;

    // ±10 % jitter to avoid a thundering-herd on server restarts
    const jitter = backoffMs * 0.1 * (Math.random() * 2 - 1);
    const delay = Math.round(backoffMs + jitter);

    console.log(
      `[slack-ws] Reconnecting in ${delay} ms (next backoff: ${Math.min(backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS)} ms)…`,
    );

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);

    backoffMs = Math.min(backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
  }

  async function handleTaskPayload(payload: TaskPayload): Promise<void> {
    console.log(
      `[slack-ws] Received task payload: "${payload.prompt}"` +
        (payload.slackChannelId ? ` (channel: ${payload.slackChannelId})` : ""),
    );

    const result = await createTask(config.userConfig, payload.prompt);
    console.log(`[slack-ws] Task created: ${result.taskId}`);
  }

  async function handleListTasksRequest(
    request: WsListTasksRequest,
  ): Promise<void> {
    console.log(
      `[slack-ws] Received list_tasks_request (id: ${request.requestId}, column: ${request.column ?? "all"})`,
    );

    let response: WsListTasksResponse;

    try {
      const tasks = await listTasks(config.userConfig, request.column);

      // KanbanTask satisfies KanbanTaskSummary structurally (superset of fields)
      const summaries: KanbanTaskSummary[] = tasks.map(({ id, prompt, column }) => ({
        id,
        prompt,
        column,
      }));

      response = {
        type: "list_tasks_response",
        requestId: request.requestId,
        tasks: summaries,
      };

      console.log(
        `[slack-ws] Returning ${summaries.length} task(s) for list_tasks_request ${request.requestId}`,
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(
        `[slack-ws] Failed to list tasks for request ${request.requestId}:`,
        error,
      );
      response = {
        type: "list_tasks_response",
        requestId: request.requestId,
        tasks: [],
        error,
      };
    }

    if (ws !== null && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
    } else {
      console.warn(
        `[slack-ws] Cannot send list_tasks_response: connection not open (state: ${ws?.readyState ?? "null"})`,
      );
    }
  }

  function handleMessage(data: RawData): void {
    let parsed: WsServerMessage;

    try {
      parsed = JSON.parse(data.toString()) as WsServerMessage;
    } catch {
      console.warn(
        "[slack-ws] Received non-JSON message, ignoring:",
        data.toString().slice(0, 200),
      );
      return;
    }

    if (isTaskPayload(parsed)) {
      handleTaskPayload(parsed).catch((err: unknown) => {
        console.error(
          "[slack-ws] Failed to create task:",
          err instanceof Error ? err.message : String(err),
        );
      });
    } else if (isListTasksRequest(parsed)) {
      handleListTasksRequest(parsed).catch((err: unknown) => {
        console.error(
          "[slack-ws] Failed to handle list_tasks_request:",
          err instanceof Error ? err.message : String(err),
        );
      });
    } else {
      console.debug("[slack-ws] Unhandled message type:", parsed.type);
    }
  }

  function connect(): void {
    if (stopped) return;

    console.log(
      `[slack-ws] Connecting to ${config.serverWsUrl} (user: ${config.slackUserId})…`,
    );

    ws = new WebSocket(config.serverWsUrl);

    ws.on("open", () => {
      backoffMs = INITIAL_BACKOFF_MS;

      console.log("[slack-ws] Connected. Sending auth…");

      const authMessage: WsAuthMessage = {
        type: "auth",
        slackUserId: config.slackUserId,
        accessToken: config.accessToken,
      };

      ws!.send(JSON.stringify(authMessage));
    });

    ws.on("message", handleMessage);

    ws.on("close", (code: number, reason: Buffer) => {
      ws = null;
      if (stopped) return;

      const reasonStr = reason.length > 0 ? ` — ${reason.toString()}` : "";
      console.warn(`[slack-ws] Connection closed (code ${code}${reasonStr}).`);
      scheduleReconnect();
    });

    ws.on("error", (err: Error) => {
      // The 'close' event always fires after 'error'; log here and let
      // the close handler drive the reconnect decision.
      console.error("[slack-ws] WebSocket error:", err.message);
    });
  }

  connect();

  return function stop(): void {
    if (stopped) return;
    stopped = true;

    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (ws !== null) {
      ws.close(1000, "client shutdown");
      ws = null;
    }

    console.log("[slack-ws] Client stopped.");
  };
}
