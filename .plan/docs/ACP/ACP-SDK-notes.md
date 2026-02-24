# Agent Client Protocol TypeScript SDK - Reference

Package: `@agentclientprotocol/sdk` (v0.14.1)
Protocol Version: 1
Transport: Newline-delimited JSON (NDJSON) over stdio, using JSON-RPC 2.0

---

## File Structure

```
src/
  acp.ts                 # Core connection classes (AgentSideConnection, ClientSideConnection)
  stream.ts              # Stream abstraction and ndJsonStream transport
  jsonrpc.ts             # JSON-RPC 2.0 type definitions
  schema/
    index.ts             # Exported types, method constants, and protocol version
    types.gen.ts          # Auto-generated 200+ types from schema.json
    zod.gen.ts            # Zod validation schemas for all types
```

---

## Core Classes

### ClientSideConnection

Client-side connection to an agent. Implements the Agent interface so you call agent methods on it directly.

```typescript
constructor(
  toClient: (agent: Agent) => Client,
  stream: Stream
)
```

The `toClient` factory receives the connection (typed as Agent) and must return your Client implementation.

Methods (Agent interface - these send requests to the agent):

- `initialize(params: InitializeRequest): Promise<InitializeResponse>` - negotiate protocol version and capabilities
- `newSession(params: NewSessionRequest): Promise<NewSessionResponse>` - create session with cwd and MCP servers
- `loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse>` - load existing session (optional capability)
- `unstable_listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse>` - list sessions (experimental)
- `unstable_forkSession(params: ForkSessionRequest): Promise<ForkSessionResponse>` - fork a session (experimental)
- `unstable_resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse>` - resume without replay (experimental)
- `setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse>` - change mode (ask, code, architect)
- `unstable_setSessionModel(params: SetSessionModelRequest): Promise<SetSessionModelResponse>` - change model (experimental)
- `setSessionConfigOption(params: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse>` - set config option
- `prompt(params: PromptRequest): Promise<PromptResponse>` - send user prompt, await completion
- `cancel(params: CancelNotification): Promise<void>` - cancel ongoing operation (notification)
- `authenticate(params: AuthenticateRequest): Promise<AuthenticateResponse>` - authenticate with agent
- `extMethod(method, params): Promise<Record<string, unknown>>` - send custom request
- `extNotification(method, params): Promise<void>` - send custom notification

Properties:
- `signal: AbortSignal` - aborts when connection closes
- `closed: Promise<void>` - resolves when connection closes

### AgentSideConnection

Agent-side connection to a client. Used when building an agent (not a client).

```typescript
constructor(
  toAgent: (conn: AgentSideConnection) => Agent,
  stream: Stream
)
```

Methods (for sending to client):
- `sessionUpdate(params: SessionNotification): Promise<void>` - send real-time updates
- `requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse>` - ask user permission
- `readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse>` - read file from client
- `writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse>` - write file on client
- `createTerminal(params: CreateTerminalRequest): Promise<TerminalHandle>` - create terminal, get handle
- `extMethod(method, params)` / `extNotification(method, params)` - custom methods

### TerminalHandle

Returned by `createTerminal()`. Supports `Symbol.asyncDispose` for `await using`.

- `id: string` - terminal ID
- `currentOutput(): Promise<TerminalOutputResponse>` - get current output without waiting
- `waitForExit(): Promise<WaitForTerminalExitResponse>` - wait for process exit
- `kill(): Promise<KillTerminalCommandResponse>` - send SIGTERM
- `release(): Promise<ReleaseTerminalResponse | void>` - release resources, kill if running

### RequestError

Standard error class with factory methods:

```typescript
class RequestError extends Error {
  code: number;
  data?: unknown;

  static parseError(data?, msg?): RequestError;         // -32700
  static invalidRequest(data?, msg?): RequestError;     // -32600
  static methodNotFound(method): RequestError;          // -32601
  static invalidParams(data?, msg?): RequestError;      // -32602
  static internalError(data?, msg?): RequestError;      // -32603
  static authRequired(data?, msg?): RequestError;       // -32000
  static resourceNotFound(uri?): RequestError;          // -32002

  toResult<T>(): Result<T>;
  toErrorResponse(): ErrorResponse;
}
```

---

## Transport Layer

### Stream Type

```typescript
type Stream = {
  writable: WritableStream<AnyMessage>;
  readable: ReadableStream<AnyMessage>;
};
```

### ndJsonStream()

Creates a Stream from byte streams (stdio):

```typescript
function ndJsonStream(
  output: WritableStream<Uint8Array>,
  input: ReadableStream<Uint8Array>
): Stream
```

Reads from input, splits by newlines, parses JSON. Encodes writable messages as JSON + newline.

---

## Protocol Constants

```typescript
const PROTOCOL_VERSION = 1;

const AGENT_METHODS = {
  initialize: "initialize",
  authenticate: "authenticate",
  session_new: "session/new",
  session_load: "session/load",
  session_list: "session/list",           // unstable
  session_fork: "session/fork",           // unstable
  session_resume: "session/resume",       // unstable
  session_prompt: "session/prompt",
  session_set_mode: "session/set_mode",
  session_set_model: "session/set_model", // unstable
  session_set_config_option: "session/set_config_option",
  session_cancel: "session/cancel",       // notification
};

const CLIENT_METHODS = {
  session_update: "session/update",              // notification
  session_request_permission: "session/request_permission",
  fs_read_text_file: "fs/read_text_file",
  fs_write_text_file: "fs/write_text_file",
  terminal_create: "terminal/create",
  terminal_output: "terminal/output",
  terminal_wait_for_exit: "terminal/wait_for_exit",
  terminal_kill: "terminal/kill",
  terminal_release: "terminal/release",
};
```

---

## Client Interface (what you implement as a client)

```typescript
interface Client {
  // Required
  requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse>;
  sessionUpdate(params: SessionNotification): Promise<void>;

  // Optional - file system (check capabilities)
  writeTextFile?(params: WriteTextFileRequest): Promise<WriteTextFileResponse>;
  readTextFile?(params: ReadTextFileRequest): Promise<ReadTextFileResponse>;

  // Optional - terminal (check capabilities)
  createTerminal?(params: CreateTerminalRequest): Promise<CreateTerminalResponse>;
  terminalOutput?(params: TerminalOutputRequest): Promise<TerminalOutputResponse>;
  releaseTerminal?(params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse | void>;
  waitForTerminalExit?(params: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse>;
  killTerminal?(params: KillTerminalCommandRequest): Promise<KillTerminalCommandResponse | void>;

  // Extension
  extMethod?(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  extNotification?(method: string, params: Record<string, unknown>): Promise<void>;
}
```

---

## Agent Interface (what agents implement)

```typescript
interface Agent {
  // Required
  initialize(params: InitializeRequest): Promise<InitializeResponse>;
  newSession(params: NewSessionRequest): Promise<NewSessionResponse>;
  prompt(params: PromptRequest): Promise<PromptResponse>;
  cancel(params: CancelNotification): Promise<void>;
  authenticate(params: AuthenticateRequest): Promise<AuthenticateResponse | void>;

  // Optional
  loadSession?(params: LoadSessionRequest): Promise<LoadSessionResponse>;
  unstable_forkSession?(params: ForkSessionRequest): Promise<ForkSessionResponse>;
  unstable_listSessions?(params: ListSessionsRequest): Promise<ListSessionsResponse>;
  unstable_resumeSession?(params: ResumeSessionRequest): Promise<ResumeSessionResponse>;
  setSessionMode?(params: SetSessionModeRequest): Promise<SetSessionModeResponse | void>;
  unstable_setSessionModel?(params: SetSessionModelRequest): Promise<SetSessionModelResponse | void>;
  setSessionConfigOption?(params: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse>;

  // Extension
  extMethod?(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  extNotification?(method: string, params: Record<string, unknown>): Promise<void>;
}
```

---

## Request/Response Types

### InitializeRequest
```typescript
{
  protocolVersion: number;
  clientCapabilities?: ClientCapabilities;
  clientInfo?: Implementation;      // {name, version, title?}
}
```

### InitializeResponse
```typescript
{
  protocolVersion: number;
  agentCapabilities?: AgentCapabilities;
  agentInfo?: Implementation;
  authMethods?: AuthMethod[];       // [{id, name, description?}]
}
```

### NewSessionRequest
```typescript
{
  cwd: string;                      // absolute path
  mcpServers: McpServer[];
}
```

### NewSessionResponse
```typescript
{
  sessionId: SessionId;
  configOptions?: SessionConfigOption[];
  modes?: SessionModeState;         // {availableModes, currentModeId}
  models?: SessionModelState;       // {availableModels, currentModelId}
}
```

### PromptRequest
```typescript
{
  sessionId: SessionId;
  prompt: ContentBlock[];           // array of text, image, audio, or resource blocks
}
```

### PromptResponse
```typescript
{
  stopReason: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";
  usage?: Usage;
}
```

### RequestPermissionRequest
```typescript
{
  sessionId: SessionId;
  toolCall: ToolCallUpdate;
  options: PermissionOption[];      // [{optionId, name, kind}]
}
```

### RequestPermissionResponse
```typescript
{
  outcome: RequestPermissionOutcome;  // {outcome: "selected"|"cancelled", optionId?}
}
```

### ReadTextFileRequest / Response
```typescript
// Request
{ sessionId: SessionId; path: string; line?: number; limit?: number; }
// Response
{ content: string; }
```

### WriteTextFileRequest / Response
```typescript
// Request
{ sessionId: SessionId; path: string; content: string; }
// Response
{}
```

### CreateTerminalRequest / Response
```typescript
// Request
{ sessionId: SessionId; command: string; args?: string[]; cwd?: string; env?: EnvVariable[]; outputByteLimit?: number; }
// Response
{ terminalId: string; }
```

### TerminalOutputResponse
```typescript
{ output: string; truncated: boolean; exitStatus?: TerminalExitStatus; }
```

### WaitForTerminalExitResponse
```typescript
{ exitCode?: number; signal?: string; }
```

---

## Session Update Types

SessionNotification wraps all updates:
```typescript
{ sessionId: SessionId; update: SessionUpdate; }
```

SessionUpdate is a discriminated union on `sessionUpdate` field:

- `"user_message_chunk"` - ContentChunk: `{content: {type: "text", text: string}}`
- `"agent_message_chunk"` - ContentChunk: `{content: {type: "text", text: string}}`
- `"agent_thought_chunk"` - ContentChunk: `{content: {type: "text", text: string}}`
- `"tool_call"` - ToolCall: `{toolCallId, title, kind?, status?, rawInput?, rawOutput?, content?, locations?}`
- `"tool_call_update"` - ToolCallUpdate: `{toolCallId, title?, kind?, status?, rawInput?, rawOutput?, content?, locations?}`
- `"plan"` - Plan: `{entries: [{content, status, priority}]}`
- `"available_commands_update"` - `{availableCommands: [{name, description, input?: {hint}}]}`
- `"current_mode_update"` - `{currentModeId: SessionModeId}`
- `"config_option_update"` - config option changed
- `"session_info_update"` - session info changed
- `"usage_update"` - `{size, used, cost?}`

---

## Content Types

```typescript
type ContentBlock =
  | { type: "text"; text: string; annotations?: Annotations; }
  | { type: "image"; data: string; mimeType: string; uri?: string; }
  | { type: "audio"; data: string; mimeType: string; }
  | { type: "resource_link"; uri: string; name: string; mimeType?: string; size?: number; }
  | { type: "resource"; resource: TextResourceContents | BlobResourceContents; }
```

---

## Tool Call Types

```typescript
type ToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "switch_mode" | "other";
type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

interface ToolCall {
  toolCallId: ToolCallId;
  title: string;
  kind?: ToolKind;
  status?: ToolCallStatus;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: ToolCallContent[];      // [{type: "content"|"diff"|"terminal", ...}]
  locations?: ToolCallLocation[];   // [{path, line?}]
}

// Diff content
interface Diff { path: string; newText: string; oldText?: string; }

// Terminal content
interface Terminal { terminalId: string; }
```

---

## Capability Types

### ClientCapabilities
```typescript
{
  fs?: { readTextFile?: boolean; writeTextFile?: boolean; };
  terminal?: boolean;
}
```

### AgentCapabilities
```typescript
{
  loadSession?: boolean;
  promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean; };
  mcpCapabilities?: { http?: boolean; sse?: boolean; };
  sessionCapabilities?: { fork?: ...; list?: ...; resume?: ...; };
}
```

---

## Session Configuration

```typescript
interface SessionConfigOption {
  type: "select";
  id: SessionConfigId;
  name: string;
  description?: string;
  category?: "mode" | "model" | "thought_level" | string;
  currentValue: SessionConfigValueId;
  options: SessionConfigSelectOption[] | SessionConfigSelectGroup[];
}
```

---

## MCP Server Types

```typescript
type McpServer =
  | { name: string; command: string; args: string[]; env: EnvVariable[]; }           // stdio
  | { name: string; type: "http"; url: string; headers: HttpHeader[]; }              // HTTP
  | { name: string; type: "sse"; url: string; headers: HttpHeader[]; }               // SSE
```

---

## Utility Types

```typescript
interface Implementation { name: string; version: string; title?: string; }
interface AuthMethod { id: string; name: string; description?: string; }
interface Usage { inputTokens: number; outputTokens: number; totalTokens: number; cachedReadTokens?: number; cachedWriteTokens?: number; thoughtTokens?: number; }
interface UsageUpdate { size: number; used: number; cost?: Cost; }
interface Cost { amount: number; currency: string; }
interface Annotations { audience?: Role[]; priority?: number; lastModified?: string; }
```

---

## Zod Validation

All types have corresponding Zod validators in `schema/zod.gen.ts`:
```typescript
import * as validate from '@agentclientprotocol/sdk/schema/zod.gen';
const params = validate.zInitializeRequest.parse(incoming);
```

The SDK automatically validates incoming parameters and throws `RequestError.invalidParams()` on failure.

---

## Usage Example (Building a Client)

```typescript
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type { Client, SessionNotification, RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';

class MyClient implements Client {
  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    // Present options to user, return selection
    return { outcome: { outcome: "selected", optionId: params.options[0].optionId } };
  }

  async sessionUpdate(params: SessionNotification): Promise<void> {
    const update = params.update;
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        process.stdout.write(update.content.text);
        break;
      case "agent_thought_chunk":
        // handle thinking
        break;
      case "tool_call":
        console.log(`Tool: ${update.title} [${update.status}]`);
        break;
      case "tool_call_update":
        console.log(`Tool update: ${update.toolCallId} -> ${update.status}`);
        break;
    }
  }

  async readTextFile(params) {
    const fs = await import('fs/promises');
    const content = await fs.readFile(params.path, 'utf-8');
    return { content };
  }

  async writeTextFile(params) {
    const fs = await import('fs/promises');
    await fs.writeFile(params.path, params.content, 'utf-8');
    return {};
  }
}

// Set up transport
const stream = ndJsonStream(
  processStdinAsWritable,   // WritableStream<Uint8Array> to agent's stdin
  processStdoutAsReadable   // ReadableStream<Uint8Array> from agent's stdout
);

// Create connection
const connection = new ClientSideConnection(
  (agent) => new MyClient(),
  stream
);

// Initialize
const initResponse = await connection.initialize({
  protocolVersion: PROTOCOL_VERSION,
  clientInfo: { name: "my-client", version: "1.0.0" },
  clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true }
});

// Create session
const session = await connection.newSession({
  cwd: process.cwd(),
  mcpServers: []
});

// Send prompt
const response = await connection.prompt({
  sessionId: session.sessionId,
  prompt: [{ type: "text", text: "Hello!" }]
});

console.log("Stop reason:", response.stopReason);
```

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| -32700 | Parse error | Invalid JSON |
| -32600 | Invalid request | Not a valid JSON-RPC request |
| -32601 | Method not found | Method does not exist |
| -32602 | Invalid params | Invalid method parameters |
| -32603 | Internal error | Internal error |
| -32000 | Auth required | Authentication needed before session creation |
| -32002 | Resource not found | Requested resource doesn't exist |
