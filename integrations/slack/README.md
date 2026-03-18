# Kanban Slack Integration

Enables users to create kanban tasks by mentioning `@kanban` in Slack. The integration is split between a central server (private repo) and a local client (this package).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Kanban Settings UI                       │
│   "Connect to Slack" → OAuth v2 flow → saves credentials to    │
│   ~/.kanban/integrations/slack.json                             │
└────────────────────────────┬────────────────────────────────────┘
                             │  RegisterUserRequest (HTTP POST /register)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Slack App Server (cline/kanban-integrations)        │
│   - User registry (SlackUserRecord store)                       │
│   - @mention routing → active WebSocket connection              │
└─────────────────────────────────────────────────────────────────┘
                             ▲
                             │  Persistent WebSocket (/connect)
                             │  outbound only — no public URL or tunnel needed
                             │
┌─────────────────────────────────────────────────────────────────┐
│               Local Kanban Instance (this package)              │
│   Reads ~/.kanban/integrations/slack.json, connects, receives   │
│   TaskPayload messages and creates tasks via local HTTP API     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Server-side setup

The Slack OAuth App and App Server live in the private [cline/kanban-integrations](https://github.com/cline/kanban-integrations) repo. See that repo for deployment instructions.

---

## Local client (this package)

[`src/index.ts`](./src/index.ts) starts the client. On launch it reads `~/.kanban/integrations/slack.json` (written by the kanban runtime after the Settings UI OAuth flow). If the file isn't present yet, it watches for it and starts once it appears.

[`src/ws-client.ts`](./src/ws-client.ts) manages the connection:

1. Connects outbound to the Slack App Server `/connect` endpoint.
2. Authenticates with a [`WsAuthMessage`](./src/types.ts) (`slackUserId` + `accessToken`).
3. Receives [`TaskPayload`](./src/types.ts) messages and creates tasks via the local HTTP API ([`src/kanban-client.ts`](./src/kanban-client.ts)).
4. Handles [`WsListTasksRequest`](./src/types.ts) by querying the local board and replying with a [`WsListTasksResponse`](./src/types.ts).
5. Reconnects automatically with exponential backoff (1 s → 60 s, ±10 % jitter).

### Running locally

```bash
npm run dev   # tsx (reads config from ~/.kanban/integrations/slack.json)
npm run build # compile
npm start     # run compiled output
```

---

## Shared types

All wire contracts live in [`src/types.ts`](./src/types.ts):

| Type | Description |
|------|-------------|
| `SlackUserRecord` | Persisted record mapping a Slack user to their bot token |
| `RegisterUserRequest` | Sent from the kanban runtime to the App Server after OAuth |
| `RegisterUserResponse` | Response from the App Server's `/register` endpoint |
| `OAuthCallbackPayload` | Subset of Slack's `oauth.v2.access` response |
| `WsAuthMessage` | First message sent by the client after connecting |
| `TaskPayload` | Pushed by the server when an `@kanban` mention is received |
| `WsListTasksRequest` | Sent by the server to request the client's current task list |
| `WsListTasksResponse` | Client reply to a `WsListTasksRequest` |
| `KanbanTaskSummary` | Minimal task shape used in list responses |
| `WsServerMessage` | Union of all server → client message types |
| `WsClientMessage` | Union of all client → server message types |
