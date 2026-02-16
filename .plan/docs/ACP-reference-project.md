# ACP Client Reference: formulahendry/vscode-acp

Located at ~/Repositories/kanban-idea/vscode-acp

This is a comprehensive technical reference for the vscode-acp codebase (a VS Code extension implementing an ACP client). You can use this to understand how an ACP client works and as a reference for building your own.

---

## FILE TREE

```
src/
  core/
    AcpClientImpl.ts          # ACP protocol implementation (Client interface)
    ConnectionManager.ts      # Manages ACP connections to agent processes
    AgentManager.ts           # Spawns and manages agent child processes
    SessionManager.ts         # Orchestrates agent sessions and lifecycle
  handlers/
    FileSystemHandler.ts      # Handles file read/write requests from agents
    TerminalHandler.ts        # Manages terminal creation and execution
    PermissionHandler.ts      # Handles permission requests from agents
    SessionUpdateHandler.ts   # Routes session updates to UI listeners
  ui/
    ChatWebviewProvider.ts    # Webview chat UI (1800+ lines of HTML/JS/CSS)
    SessionTreeProvider.ts    # Tree view for agent list
    StatusBarManager.ts       # Status bar indicator
  config/
    AgentConfig.ts            # Agent configuration from VS Code settings
    RegistryClient.ts         # Fetches ACP agent registry from CDN
  utils/
    Logger.ts                 # Logging to output channels
    TelemetryManager.ts       # Telemetry reporting
    StreamAdapter.ts          # Web Streams adapter (minimal usage)
  extension.ts                # Extension activation and command handlers
  test/
    extension.test.ts
```

---

## ARCHITECTURE AND DATA FLOW

```
+------------------------------------------+
|        VS Code Extension Host            |
|------------------------------------------|
| Extension.ts (orchestration & commands)   |
|                                          |
|  SessionManager                          |
|  +-- AgentManager                        |
|  +-- ConnectionManager                   |
|  +-- SessionUpdateHandler                |
|                                          |
|  UI Layer                                |
|  +-- ChatWebviewProvider                 |
|  +-- SessionTreeProvider                 |
|  +-- StatusBarManager                    |
|                                          |
|  Handlers                                |
|  +-- FileSystemHandler                   |
|  +-- TerminalHandler                     |
|  +-- PermissionHandler                   |
|  +-- SessionUpdateHandler                |
+-----------------+------------------------+
                  | stdio (JSON-RPC over ND-JSON)
+-----------------v------------------------+
|     Agent Child Process (spawned)        |
|  (Claude Code, Copilot, Gemini, etc.)    |
+------------------------------------------+
```

### User Prompt Flow (end to end)

1. User types in chat webview and hits Enter
2. Webview posts message: {type: 'sendPrompt', text: 'hello'}
3. ChatWebviewProvider.handleSendPrompt() posts {type: 'promptStart'} to webview, calls sessionManager.sendPrompt()
4. SessionManager gets connection from ConnectionManager, calls connection.prompt({sessionId, prompt: [{type: 'text', text}]})
5. Connection sends JSON-RPC request over ND-JSON to agent's stdin
6. Agent processes prompt and streams back sessionUpdate notifications (agent_message_chunk, agent_thought_chunk, tool_call, tool_call_update)
7. ConnectionManager event loop receives notifications, routes to SessionUpdateHandler
8. SessionUpdateHandler broadcasts to listeners (ChatWebviewProvider)
9. ChatWebviewProvider posts {type: 'sessionUpdate', update} to webview
10. Webview JS parses update type, renders message/thought/tool/plan, requests markdown rendering
11. Extension uses marked.parse() on text, sends back HTML
12. Agent sends PromptResponse when turn complete (stopReason: end_turn | tool_use | cancel | max_tokens)
13. ChatWebviewProvider posts {type: 'promptEnd'} to webview, input re-enabled

---

## ACP PROTOCOL METHODS

### Client-side (implemented by AcpClientImpl, responding to agent requests)

File System:
- client/readTextFile(params) -> {content: string}
  - params: path, line? (1-based), limit?
  - Checks if file is open in editor first (returns unsaved content), falls back to workspace.fs
  - Supports partial reads via line/limit

- client/writeTextFile(params) -> {}
  - params: path, content
  - Creates parent dirs automatically, opens file in editor with preview mode

Terminal:
- client/createTerminal(params) -> {terminalId: string}
  - params: command, args, cwd, env, outputByteLimit
  - Spawns child process with piped stdio, creates VS Code Pseudoterminal

- client/terminalOutput(params) -> {output, truncated, exitStatus?}
  - params: terminalId

- client/waitForTerminalExit(params) -> {exitCode, signal}
  - params: terminalId
  - Blocks until process exits

- client/killTerminal(params) -> {}
  - params: terminalId, sends SIGTERM

- client/releaseTerminal(params) -> {}
  - params: terminalId
  - Kills process if running, keeps VS Code terminal visible

Permissions:
- client/requestPermission(params) -> {outcome: {outcome: 'selected'|'cancelled', optionId?: string}}
  - params: toolCall?, options (array of {optionId, name, kind})
  - kind values: allow_once, allow_always, deny_once, deny_always
  - Supports auto-approve setting (ask | allowAll)

Session Updates (notifications, no response):
- client/sessionUpdate(params) -> void
  - params: sessionId, update (with sessionUpdate type discriminator)
  - Types:
    - agent_message_chunk: {content: {type: 'text', text}}
    - agent_thought_chunk: {content: {type: 'text', text}}
    - tool_call: {toolCallId, title, status: pending|running|completed|failed}
    - tool_call_update: {toolCallId, status, title?}
    - plan: {entries: [{title?, description?, content?, status: pending|in_progress|completed}]}
    - current_mode_update: {currentModeId?, modeId?}
    - available_commands_update: {availableCommands: [{name, description, input?: {hint}}]}

### Agent-side (methods the client calls on the agent)

Connection:
- initialize(params) -> InitializeResponse
  - params: protocolVersion, clientInfo: {name, version}, clientCapabilities: {fs: {readTextFile, writeTextFile}, terminal}
  - Response: {agentInfo?, authMethods?}

- authenticate(params) -> void
  - params: methodId (from InitializeResponse.authMethods)

Session:
- session/new(params) -> NewSessionResponse
  - params: cwd, mcpServers (array)
  - Response: {sessionId, modes?: {availableModes, currentModeId}, models?: {availableModels, currentModelId}}

- session/setMode(params) -> void
  - params: sessionId, modeId

- session/setModel(params) -> void (unstable_setSessionModel, experimental)
  - params: sessionId, modelId

Prompting:
- prompt(params) -> PromptResponse
  - params: sessionId, prompt (array of ContentBlocks)
  - Response: {stopReason: end_turn|tool_use|cancel|max_tokens}

- cancel(params) -> void
  - params: sessionId

---

## TRANSPORT LAYER

Protocol: Bidirectional JSON-RPC 2.0 over newline-delimited JSON (ND-JSON) over stdio.

Each message is a complete JSON object on one line, separated by \n.

Request:  {"jsonrpc": "2.0", "id": 1, "method": "prompt", "params": {...}}
Response: {"jsonrpc": "2.0", "id": 1, "result": {...}}
Notification (no id): {"jsonrpc": "2.0", "method": "client/sessionUpdate", "params": {...}}

Stream setup:
1. Child process spawned with stdio: ['pipe', 'pipe', 'pipe']
2. process.stdout -> ReadableStream (via Readable.toWeb)
3. process.stdin -> WritableStream (via Writable.toWeb)
4. ndJsonStream(writable, readable) creates the Stream object
5. TransformStreams wrap both directions for traffic logging/tapping
6. ClientSideConnection from @agentclientprotocol/sdk handles JSON-RPC framing

SDK usage: Uses @agentclientprotocol/sdk v0.14.1, specifically:
- ClientSideConnection: manages the JSON-RPC connection
- ndJsonStream: handles ND-JSON transport
- Client interface: defines the client-side methods to implement

---

## AGENT PROCESS SPAWNING

Windows: Uses cmd.exe shell (shell: true flag) to resolve batch scripts like npx.

Unix: Detects user's shell from $SHELL and uses login flag for profile sourcing:
- zsh, bash, ksh: -l flag (sources profile for nvm/Homebrew PATH)
- fish: no flag (auto-loads config)
- sh, dash: no flag (don't support -l reliably)
- Fallback: /bin/bash or /bin/sh

Arguments are escaped with single quotes for shell safety.

Lifecycle:
1. Spawn with piped stdio
2. Forward stderr to log
3. Listen for error/close events
4. On disconnect: SIGTERM, then SIGKILL after 5 seconds
5. Single agent at a time model (switching agents disconnects previous)

---

## AUTHENTICATION FLOW

Trigger: Agent responds to session/new with error code -32000 (auth_required).

Detection:
- RequestError with code -32000
- Or message matching /auth.?required/i

Resolution:
1. Read authMethods from InitializeResponse (each has id, name, description)
2. If 1 method: show confirmation dialog. If >1: show QuickPick
3. Call connection.authenticate({methodId: selectedMethod.id})
4. Retry session/new
5. On failure: kill agent, throw error

---

## CONNECTION FLOW

1. User selects agent to connect
2. AgentManager.spawnAgent() creates child process
3. ConnectionManager.connect() sets up streams:
   - Convert Node streams to Web Streams
   - Create ndJsonStream for JSON-RPC
   - Tap streams for traffic logging
   - Create AcpClientImpl with handlers
   - Create ClientSideConnection with factory pattern
4. Send initialize request with protocol version and capabilities
5. Agent responds with InitializeResponse
6. Call session/new with cwd and mcpServers
7. Handle auth if needed (see above)
8. Store session info, emit events
9. UI updates (chat enabled, status bar, tree view)

---

## KEY TYPES

```typescript
interface AgentConfigEntry {
  command: string;          // e.g., "npx"
  args?: string[];          // e.g., ["@zed/claude-code-acp@latest"]
  env?: Record<string, string>;
  displayName?: string;
}

interface ConnectionInfo {
  connection: ClientSideConnection;
  client: AcpClientImpl;
  initResponse: InitializeResponse;
}

interface AgentInstance {
  id: string;
  name: string;
  process: ChildProcess;
  config: AgentConfigEntry;
}

interface SessionInfo {
  sessionId: string;
  agentId: string;
  agentName: string;
  agentDisplayName: string;
  cwd: string;
  createdAt: string;
  initResponse: InitializeResponse;
  modes: SessionModeState | null;
  models: SessionModelState | null;
  availableCommands: AvailableCommand[];
}

interface ManagedTerminal {
  id: string;
  process: ChildProcess;
  output: string;
  truncated: boolean;
  outputByteLimit: number;
  exitCode: number | null;
  exitSignal: string | null;
  exited: boolean;
  exitPromise: Promise<void>;
  vsTerminal?: vscode.Terminal;
}
```

---

## KEY PATTERNS

1. Handler pattern: Each handler specializes in one domain (FileSystem, Terminal, Permission, SessionUpdate). AcpClientImpl delegates to them.

2. Factory pattern: ClientSideConnection takes a factory: `new ClientSideConnection((agent) => { client.setAgent(agent); return client; }, stream)`

3. EventEmitter pattern: SessionManager emits agent-connected, agent-disconnected, agent-error, agent-closed, active-session-changed, clear-chat, mode-changed, model-changed.

4. Stream tapping: TransformStreams wrap both directions for logging without modifying data flow.

5. Unsaved editor content: File reads return editor content if the file is open (not just disk content). This ensures agents see the working copy.

6. Webview messaging: Bidirectional postMessage between extension host and webview. Extension handles markdown rendering (due to CSP), webview handles DOM updates.

7. State persistence: Webview uses vscode.setState/getState to preserve chat history across reloads.

---

## KEY INSIGHTS FOR BUILDERS

- JSON-RPC over ND-JSON is the transport. Each message is a complete JSON object on one line.
- Shell selection is critical on Unix. Login shells are needed for nvm/Homebrew paths.
- File reads should check for unsaved editor content, not just disk.
- Terminal output is bounded by byte limit and truncated from the beginning.
- All traffic should be logged for debugging (tap the streams).
- Auth flow is triggered by a -32000 error code on session/new.
- Permission requests come from the agent with options; the client presents UI and returns the selected option.
- Session updates are the primary streaming mechanism. The agent sends notifications, not responses, for streaming content.
- Thought blocks, tool calls, and plans are all delivered via session updates with different sessionUpdate type discriminators.
- The SDK (@agentclientprotocol/sdk) provides ClientSideConnection, ndJsonStream, and the Client interface. You implement Client, the SDK handles JSON-RPC.
