# TUI-Based Agent Integration: Replacing ACP with Embedded Terminal Approach

## Context and Motivation

This document captures the findings from a deep investigation of vibe-kanban's agent integration architecture, and lays out an alternative approach for a product that manages worktrees and tasks in a kanban view while delegating coding work to CLI agents like Claude Code and Codex.

The core insight: CLI agents are updated constantly with new features, UI improvements, and capabilities. Building a custom UI layer on top of their structured output (like vibe-kanban does) creates a brittle system that breaks with every update and requires constant maintenance to keep feature parity. Instead, we embed the agent's own TUI directly in the browser via xterm.js and use lightweight notification mechanisms to integrate with the kanban layer.

---

## What Vibe-Kanban Does (and Why We're Not Doing That)

### Their Architecture

Vibe-kanban supports ~9 different agents (Claude Code, Codex, OpenCode, Cursor, Copilot, Gemini, Qwen, Droid, Amp) and uses three different integration strategies:

1. Custom control protocols (Claude Code, Codex, OpenCode, Cursor, Droid, Amp) where they spawn the agent headlessly and parse structured JSON output
2. ACP (Agent Client Protocol) for Copilot, Gemini, and Qwen
3. MCP (Model Context Protocol) server that exposes kanban tools to agents

For Claude Code specifically, they run it with `--output-format=stream-json --input-format=stream-json` which disables the TUI entirely. Claude emits structured JSON events on stdout, vibe-kanban parses every event into a `NormalizedEntry` type (AssistantMessage, ToolUse, Thinking, UserFeedback, etc.), streams those to the frontend over WebSocket as JSON patches, and renders everything with custom React components.

### Why This Is Problematic

- The `stream-json` format is not a stable API. Claude Code updates frequently and the format changes.
- Every agent speaks a different protocol. Vibe-kanban maintains separate executor implementations for each one, each with its own type definitions, log normalization, and parsing logic.
- They're essentially rebuilding every agent's UI from scratch. When Claude Code adds a new feature (like plan mode visualization, token usage display, or a new tool type), vibe-kanban has to update their normalized types, their parser, and their frontend components to support it.
- The custom protocols for Claude Code, Codex, and OpenCode are all homegrown. Claude Code's control protocol types are hand-written serde structs matching the wire format. There's no official Anthropic crate for this. They reference an unofficial community SDK as inspiration.
- For Codex, they import OpenAI's official `codex-app-server-protocol` crate for types, but then write a custom JSON-RPC bidirectional transport layer on top because the official crate doesn't support server-initiated requests.

### What ACP Gets Wrong

ACP is the closest thing to a "standard" protocol, but only 3 out of 9 agents use it. Its limitations:

- Unidirectional: the agent asks for permission, you respond. You cannot proactively tell the agent to change behavior, switch modes, or interrupt.
- Binary approve/deny: you can allow or reject a tool call, but you cannot modify the tool's input before it executes.
- No mode control: no concept of plan mode, permission escalation, or dynamic permission changes mid-session.
- Stateless: no session state machine, no phase transitions (e.g., planning to execution).
- Still requires UI reconstruction: even with ACP, you receive structured events (thoughts, tool calls, messages) and must render them yourself. You don't get the TUI.

ACP gives you less control than the custom protocols while still requiring you to build all the UI. Worst of both worlds for our use case.

---

## Our Approach: TUI in xterm.js

### Core Idea

Instead of parsing structured output and rebuilding the UI, spawn the CLI agent in a PTY and render its actual TUI in an xterm.js terminal embedded in the web app. The user interacts with the agent through its native interface. Our product adds value through the kanban/worktree management layer around it, not by replacing the agent's UI.

### What This Gives Us

- Zero maintenance when agents update their UI or add features. Users get improvements for free.
- No protocol parsing, no normalized entry types, no custom renderers.
- Users get the full, familiar agent experience (Claude Code's TUI, Codex's TUI, etc.).
- Works with any CLI agent that has a terminal interface, with zero agent-specific code.

### What We Give Up

- No programmatic approval gating from the web app (the user approves/denies directly in the TUI).
- No ability to modify tool inputs before execution.
- No plan mode orchestration from our side (though Claude Code has its own plan mode the user can invoke).
- No structured log data for persistence/replay (we get raw terminal output, not semantic events).
- Less integration between agent actions and kanban state (e.g., can't auto-update a task status when the agent finishes a file edit).

These tradeoffs are acceptable because our product's value is in worktree/task management, not in agent orchestration.

---

## Technical Implementation

### PTY + WebSocket + xterm.js Pattern

Vibe-kanban already implements this exact pattern for their shell terminal feature (separate from agent execution). Here's how it works:

#### Backend: PTY Service

Use `portable-pty` (v0.8, cross-platform) to spawn processes in pseudo-terminals.

```
Dependencies:
- portable-pty = "0.8"  (Rust)
- or node-pty            (Node.js alternative)
```

The service manages sessions as a HashMap keyed by UUID:

- `create_session(working_dir, cols, rows)` spawns a PTY with the agent command
- Returns a `(session_id, output_receiver)` where output_receiver is an `mpsc::unbounded_channel` that streams raw bytes from the PTY
- `write(session_id, data)` sends user input (keystrokes) to the PTY's stdin
- `resize(session_id, cols, rows)` adjusts the PTY dimensions
- `close_session(session_id)` kills the process and cleans up

Environment setup for the PTY:
- `TERM=xterm-256color` and `COLORTERM=truecolor` for full color and styling support
- Set working directory to the worktree path
- Pass through any agent-specific env vars (API keys, config paths, etc.)

#### Backend: WebSocket Handler

Route: `GET /api/agent-terminal/ws?workspace_id=...&cols=80&rows=24`

Message protocol uses JSON with base64-encoded binary data for safe WebSocket text frame transport:

```
Frontend -> Backend:
  { "type": "Input",  "data": "<base64-encoded keystrokes>" }
  { "type": "Resize", "cols": 120, "rows": 40 }
  { "type": "Close" }

Backend -> Frontend:
  { "type": "Output", "data": "<base64-encoded terminal output>" }
  { "type": "Error",  "message": "..." }
  { "type": "Exit",   "code": 0 }
```

The handler spawns two async tasks:
1. Output task: reads from the PTY output channel, base64-encodes chunks, sends as WebSocket text messages
2. Input task: receives WebSocket messages, decodes base64, writes keystrokes to the PTY

#### Frontend: xterm.js Setup

```
Dependencies:
- @xterm/xterm ^5.5.0
- @xterm/addon-fit ^0.10.0       (auto-sizing to container)
- @xterm/addon-web-links ^0.11.0 (clickable URLs)
```

Terminal initialization:
```tsx
const terminal = new Terminal({
  cursorBlink: true,
  fontSize: 12,
  fontFamily: '"IBM Plex Mono", monospace',
  // theme from your design system
});

const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);
terminal.loadAddon(new WebLinksAddon());
terminal.open(containerElement);
fitAddon.fit();
```

Wire up:
- `terminal.onData(data => ws.send(encodeInput(data)))` sends keystrokes to backend
- `ws.onmessage(msg => terminal.write(decodeOutput(msg)))` renders agent output
- Use ResizeObserver on the container to call `fitAddon.fit()` and send resize messages
- Store terminal instances in a React ref/context so they survive tab switches without re-creating

Base64 encoding helpers for binary safety:
```tsx
function encodeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const binString = Array.from(bytes, (b) => String.fromCodePoint(b)).join('');
  return btoa(binString);
}

function decodeBase64(base64: string): string {
  const binString = atob(base64);
  const bytes = Uint8Array.from(binString, (c) => c.codePointAt(0)!);
  return new TextDecoder().decode(bytes);
}
```

#### Spawning the Agent

Instead of spawning a bare shell like vibe-kanban's terminal feature does, spawn the agent command directly in the PTY:

```
Claude Code:  claude --verbose
Codex:        codex
OpenCode:     opencode
```

No special flags needed. No `--output-format`, no `--sdk`, no `--acp`. Just run the agent the same way a user would in their terminal. The PTY handles all the TUI rendering, colors, cursor movement, etc.

Set the working directory to the worktree path so the agent operates in the right context.

---

## Notification System: Knowing When Agents Need Attention

The main UX challenge: the user might be looking at the kanban board while an agent running in another tab/panel needs input (e.g., permission approval, question, or it finished). We need a way to surface "hey, go check on this agent."

### Option 1: Claude Code Hooks (Limited but Workable)

Claude Code supports hooks that run shell commands on specific events. Available hook types:

- `PreToolUse`: fires before a tool executes. Receives tool name and input as env vars.
- `PostToolUse`: fires after a tool completes.
- `Notification`: fires on agent notifications.
- `Stop`: fires when Claude exits.

You can configure hooks in `.claude/settings.json` or pass them via the SDK. A hook is just a shell command, so you can have it curl a local endpoint:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "command": "curl -s http://localhost:PORT/api/hooks/needs-attention?workspace_id=WS_ID&event=tool_approval&tool=$CLAUDE_TOOL_NAME"
      }
    ],
    "Stop": [
      {
        "command": "curl -s http://localhost:PORT/api/hooks/agent-stopped?workspace_id=WS_ID"
      }
    ]
  }
}
```

Limitations of hooks:
- Shell command spawn overhead on every tool call (latency).
- No "waiting for input" hook. PreToolUse fires before the tool runs, not when Claude is waiting for the user to approve. By the time the hook fires, Claude's TUI is already showing the approval prompt to the user.
- No hook for "Claude asked a question and is waiting for a response."
- Hooks can block tool execution (non-zero exit = deny), but we don't want that since the user controls approvals directly in the TUI.
- Only Claude Code has hooks. Codex, OpenCode, and others don't have an equivalent.

### Option 2: Terminal Output Monitoring (Recommended)

Since we're already streaming the PTY output through our WebSocket, we can passively scan the output for patterns that indicate the agent needs attention. This works for any agent without requiring agent-specific hook configuration.

On the backend, as bytes flow through the output channel, run a lightweight pattern matcher:

```
Patterns indicating "needs attention":
- Claude Code: "Allow", "Deny", "Do you want to", permission prompts
- Codex: approval prompts
- Generic: input prompts (lines ending with "? ", "> ", etc.)
- Agent exit (PTY process exits)
```

This is intentionally fuzzy. We're not trying to parse semantic meaning. We just want to detect "the terminal is probably waiting for the user" and show a notification badge. False positives are fine since the cost is just an unnecessary badge; false negatives mean the user checks the terminal themselves.

Implementation:
- Backend maintains a `needs_attention: bool` flag per session
- Pattern matcher sets it to true when a prompt-like pattern is detected
- Any keystroke input from the user resets it to false
- Frontend polls or subscribes to this flag via the existing WebSocket connection
- Show a bell/badge icon on the terminal tab and/or the kanban card for that worktree

This approach:
- Works for every CLI agent with zero agent-specific code
- Has no latency overhead (scanning bytes that are already flowing through)
- Degrades gracefully (worst case: no notification, user checks manually)
- Requires no configuration on the agent side

### Option 3: Hybrid (Hooks + Output Monitoring)

Use output monitoring as the universal baseline. For Claude Code specifically, also configure hooks for higher-fidelity notifications (e.g., Stop hook to know definitively when the agent exits, PreToolUse to know the specific tool being requested). The hooks provide richer data; the output monitoring provides coverage for all agents.

---

## Integration with Kanban/Worktree Layer

### Linking Agents to Worktrees

Each kanban card (task/issue) maps to a worktree. When the user starts an agent on a task:

1. Create (or reuse) a worktree for that task
2. Spawn the agent PTY with the worktree path as the working directory
3. Associate the PTY session ID with the kanban card
4. Show a "running" indicator on the card
5. When the PTY exits (agent finishes or user closes it), update the card status

### CLAUDE.md / Agent Config Generation

When spawning an agent for a task, generate a task-specific CLAUDE.md (or equivalent config) in the worktree root with:
- Task description and acceptance criteria from the kanban card
- Repository context (branch name, base branch, related files)
- Any project-level coding conventions

This gives the agent context about what to work on without requiring any protocol-level integration.

---

## Agent-Specific Notes

### Claude Code
- Just run `claude` in the PTY. No special flags needed.
- Hooks available for enhanced notifications (PreToolUse, PostToolUse, Notification, Stop).
- Supports MCP servers via `--mcp-config` or project settings.
- Has its own plan mode that users can invoke from the TUI.
- CLAUDE.md in the worktree root will be picked up automatically.

### Codex
- Run `codex` in the PTY.
- No hooks system. Rely on output monitoring for notifications.
- Has its own sandbox modes that users configure in the TUI.
- Supports MCP via its own config format (stdio servers only).

### OpenCode
- Run `opencode` in the PTY.
- No hooks system. Rely on output monitoring.
- Supports MCP via its config format.

### Generic CLI Agents
- Any agent with a terminal interface can be embedded with zero agent-specific code.
- Output monitoring provides universal notification support.
- MCP support depends on the agent.

---

## Migration Plan: Replacing ACP

The existing codebase uses ACP for agent communication. Here's how to replace it:

### What to Remove
- All ACP client/protocol code
- Structured event parsing and normalization layers
- Custom UI components that render agent output from normalized events
- Any agent-specific executor implementations

### What to Add
1. PTY service (spawn agents in pseudo-terminals)
2. WebSocket terminal handler (bridge PTY I/O to frontend)
3. xterm.js terminal component (render agent TUI in browser)
4. Output monitoring service (detect when agent needs attention)
5. Session management (link PTY sessions to kanban cards/worktrees)

### What to Keep
- Worktree management logic
- Kanban board UI and state management
- Git operations and branch management

### Migration Steps

1. Implement the PTY service with session management
2. Add the WebSocket terminal route
3. Build the xterm.js terminal component with tab management
4. Wire up the kanban UI: "Start agent" button on a card spawns a PTY, opens a terminal tab, links them
5. Implement output monitoring for notifications
6. Add the notification badge UI (bell icon on terminal tabs and kanban cards)
7. Remove ACP code and agent-specific executors
8. (Optional) Set up MCP server for task context
9. (Optional) Configure Claude Code hooks for enhanced notifications

---

## Architecture Diagram

```
+------------------+     +-------------------+     +------------------+
|   Kanban Board   |     |   Terminal Tabs    |     |   Notification   |
|   (React)        |     |   (xterm.js)       |     |   Badges         |
+--------+---------+     +--------+----------+     +--------+---------+
         |                         |                          |
         |   "Start Agent"        |   keystrokes/output      |   needs_attention
         |                         |                          |   flag updates
         v                         v                          v
+------------------------------------------------------------------------+
|                        WebSocket Layer                                  |
|   /api/agent-terminal/ws?workspace_id=...&cols=...&rows=...            |
+------------------------------------------------------------------------+
         |                         |                          |
         v                         v                          v
+------------------+     +-------------------+     +------------------+
|   Session Mgmt   |     |   PTY Service     |     |   Output Monitor |
|   (card <-> pty) |     |   (portable-pty)  |     |   (pattern scan) |
+------------------+     +--------+----------+     +------------------+
                                   |
                                   v
                          +-------------------+
                          |   Agent Process   |
                          |   (claude, codex, |
                          |    opencode, etc.) |
                          +-------------------+
                                   |
                                   v
                          +-------------------+
                          |   Worktree (git)  |
                          |   + CLAUDE.md     |
                          +-------------------+
```


1. Why not ACP: Unidirectional, binary approve/deny only, no mode control, still requires full UI reconstruction. Only 3 of 9 agents in vibe-kanban even use it. It's not a real standard.

2. Why not custom protocols like vibe-kanban: Brittle, high maintenance, requires reverse-engineering each agent's wire format. Claude Code's control protocol types are hand-written serde structs with no official crate. When agents update, parsers break.

3. Why TUI-in-xterm: Zero agent-specific code, zero maintenance when agents update, users get the full native experience. Our product's value is in the kanban/worktree layer, not in reimplementing agent UIs.

4. Why output monitoring over hooks for notifications: Works universally across all agents. Hooks are Claude-Code-only and have no "waiting for input" event. Output monitoring is a best-effort heuristic but degrades gracefully.

