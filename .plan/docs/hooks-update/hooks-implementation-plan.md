# Hooks System for Automatic Card Transitions

## Context

Kanban spawns CLI agents (Claude Code, Codex, Gemini, OpenCode, Cline) in terminal emulators to work on tasks. Currently, the output monitor (`output-monitor.ts`) uses regex pattern matching against PTY output to detect when agents need attention (e.g., permission prompts). This is fragile -- it relies on matching strings like "permission", "y/n", etc.

CLI agents have proper hook systems that fire events at specific lifecycle points. By injecting hook configs via CLI flags when spawning agents, we can reliably detect state transitions and move cards between columns automatically:
- In Progress -> Review: agent finished, needs permission, or needs input
- Review -> In Progress: user responded to the agent

The hook scripts call `kanban hooks ingest` which POSTs to the running Kanban HTTP server to trigger the transition.

## Architecture

```
Agent CLI (claude/codex/gemini)
  |-- hook fires (Stop, Notification, UserPromptSubmit, etc.)
  |-- runs: kanban hooks ingest --task-id <id> --event <event> --port <port>
        |-- POST http://127.0.0.1:<port>/api/hooks/ingest { taskId, event }
              |-- TerminalSessionManager.transitionToReview() or transitionToRunning()
                    |-- WebSocket broadcast -> web UI updates card position
```

## Events

Two events only: `review` and `inprogress`. The hook command is:
```
kanban hooks ingest --task-id <id> --event review --port <port>
kanban hooks ingest --task-id <id> --event inprogress --port <port>
```

## Per-CLI Hook Strategy

### In Progress -> Review

| CLI | Mechanism | Events that trigger `--event review` |
|-----|-----------|--------------------------------------|
| Claude Code | `--settings '{"hooks":{...}}'` inline JSON | `Stop`, `Notification` (matcher: `permission_prompt`) |
| Codex | `-c 'notify=[...]'` inline TOML | `notify` (agent-turn-complete) |
| Gemini | `--config <temp-file>` (temp JSON settings file) | `AfterAgent`, `Notification` |
| OpenCode | Temp JS plugin file in `<taskCwd>/.opencode/plugins/` | `session.idle`, `permission.asked` |
| Cline | Stub (no inline hook injection) | Falls back to existing output-monitor |

### Review -> In Progress

| CLI | Mechanism | Events that trigger `--event inprogress` |
|-----|-----------|------------------------------------------|
| Claude Code | `--settings` hook injection | `UserPromptSubmit` |
| Codex | PTY output detection | Detect "›" character at start of line in output (Codex renders this before user messages) |
| Gemini | `--config <temp-file>` hook injection | `BeforeAgent` |
| OpenCode | Same temp JS plugin file | `permission.replied` |
| Cline | Stub | Extend existing `writeInput()` -- any PTY input while in review moves back |

## Implementation Plan

### 1. Add types to `src/runtime/api-contract.ts`

- Add `"hook"` to `RuntimeTaskSessionReviewReason` union type
- Add new interfaces:
  ```
  RuntimeHookIngestRequest { taskId: string; event: "review" | "inprogress" }
  RuntimeHookIngestResponse { ok: boolean; error?: string }
  ```

### 2. Add `"hook"` to `src/runtime/state/workspace-state.ts`

- Add `"hook"` to `VALID_REVIEW_REASONS` set (line 35)

### 3. Create `src/hooks-cli.ts` (new file)

The `kanban hooks ingest` subcommand. Lightweight, fast, no stdout output (critical since CLIs parse stdout).

```
kanban hooks ingest --task-id <id> --event review|inprogress --port <port>
```

- Parse `--task-id`, `--event`, `--port` from argv
- Validate event is `"review"` or `"inprogress"`
- HTTP POST to `http://127.0.0.1:<port>/api/hooks/ingest` with `{ taskId, event }`
- 3-second timeout on fetch
- Exit 0 on success, exit 1 on failure (errors to stderr only, never stdout)
- Export `isHooksSubcommand(argv)` for routing in cli.ts

### 4. Modify `src/runtime/terminal/session-manager.ts`

#### 4a. Extend `StartTaskSessionRequest`

Add three new fields:
- `serverPort: number` -- the Kanban HTTP server port
- `kanbanaBinaryPath: string` -- full path to the kanban script (process.argv[1])
- `workspaceId: string` -- for Gemini temp file path

#### 4b. Extend `LaunchCommand` interface

Add optional `cleanup` callback:
```
cleanup?: () => Promise<void>
```

#### 4c. Add hook injection to `buildLaunchCommand()`

For Claude Code: build a hooks JSON object with `Stop` and `Notification` (permission_prompt) firing `--event review`, and `UserPromptSubmit` firing `--event inprogress`. Serialize and append `--settings <json>` to args.

For Codex: build notify array and append `-c 'notify=[...]'` to args with `--event review`. Only covers In Progress -> Review.

For Gemini: handled separately (see 4d) since it needs a temp file.

For OpenCode: handled separately (see 4e) since it needs a temp plugin file.

For Cline: no injection (stub).

The hook command string format:
```
<process.execPath> <kanbanaBinaryPath> hooks ingest --task-id <taskId> --event review --port <port>
```

#### 4d. Add `prepareGeminiHookConfig()` async function

- Writes temp settings JSON to `~/.kanban/workspaces/<workspaceId>/hooks/gemini-<taskId>.json`
- Creates the `hooks/` subdirectory if needed
- Returns the file path and a cleanup function that deletes the file
- Config includes `AfterAgent` and `Notification` hooks firing `--event review`, and `BeforeAgent` hook firing `--event inprogress`

#### 4e. Add `prepareOpenCodePlugin()` async function

- Writes temp JS plugin file to `<taskCwd>/.opencode/plugins/kanban-<taskId>.js`
- Creates the `.opencode/plugins/` directory if needed
- Returns a cleanup function that deletes the file
- Plugin subscribes to:
  - `session.idle` and `permission.asked` -> runs `kanban hooks ingest --event review`
  - `permission.replied` -> runs `kanban hooks ingest --event inprogress`
- Plugin uses Bun's `$` shell API to execute the hook command
- Example plugin content:
  ```js
  export const KanbanPlugin = async ({ $ }) => {
    return {
      event: async ({ event }) => {
        if (event.type === "session.idle" || event.type === "permission.asked") {
          await $`<hookCmd> --event review`
        }
        if (event.type === "permission.replied") {
          await $`<hookCmd> --event inprogress`
        }
      },
    }
  }
  ```

#### 4f. Make `startTaskSession()` handle the new flow

- If agent is gemini, call `prepareGeminiHookConfig()` before `buildLaunchCommand()`, append `--config <path>` to args, and store cleanup on `ActiveProcessState`
- If agent is opencode, call `prepareOpenCodePlugin()` before spawn, store cleanup on `ActiveProcessState`
- Store cleanup on `ActiveProcessState` (add `onSessionCleanup` field)
- Call `active.onSessionCleanup?.()` in `onExit` handler and `stopTaskSession()`

#### 4g. Add `transitionToReview()` public method

```typescript
transitionToReview(taskId: string, reason: RuntimeTaskSessionReviewReason): RuntimeTaskSessionSummary | null
```
- Only transitions if state is "running"
- Clears attention buffer to prevent output-monitor re-triggering
- Emits summary via listeners and summaryListeners

#### 4h. Add `transitionToRunning()` public method

```typescript
transitionToRunning(taskId: string): RuntimeTaskSessionSummary | null
```
- Only transitions if state is "awaiting_review" and reviewReason is "attention" or "hook"
- Clears attention buffer
- Used by the hooks ingest endpoint for `user-responded` events

#### 4i. Update `writeInput()` (line 505)

Extend the existing condition to also handle `reviewReason === "hook"`:
```typescript
if (entry.summary.state === "awaiting_review" &&
    (entry.summary.reviewReason === "attention" || entry.summary.reviewReason === "hook")) {
```
Also clear `attentionBuffer` when transitioning back.

#### 4j. Add Codex "›" detection in `onData` handler

When `agentId === "codex"` and `state === "awaiting_review"`, check if new output contains "›" at the start of a line. If so, transition back to running. This is the Codex-specific fallback for Review -> In Progress since Codex only has a `notify` hook (no `UserPromptSubmit` equivalent).

Store `agentId` on `ActiveProcessState` so the onData handler can check it.

### 5. Modify `src/cli.ts`

#### 5a. Route hooks subcommand in `run()`

Before `parseCliOptions`, check `process.argv[2] === "hooks"`. If so, import and call the handler from `hooks-cli.ts`, then return.

#### 5b. Add `/api/hooks/ingest` POST endpoint

- Does NOT require workspace scoping (no `x-kanban-workspace-id` header)
- Searches `terminalManagersByWorkspaceId` to find which workspace has the task
- For `event === "review"`: calls `transitionToReview(taskId, "hook")`
- For `event === "inprogress"`: calls `transitionToRunning(taskId)`
- Triggers `broadcastRuntimeWorkspaceStateUpdated` for the affected workspace
- Returns `{ ok: true }` or `{ ok: false, error: "..." }`

#### 5c. Pass new fields to `startTaskSession()`

At the call site (around line 1193), add:
- `serverPort: port` (the `port` variable from `startServer`)
- `kanbanaBinaryPath: process.argv[1]`
- `workspaceId: scope.workspaceId`

### 6. Keep existing output-monitor as fallback

The existing `output-monitor.ts` pattern detection remains as a fallback for Cline (which has no inline hook injection) and as a secondary signal for agents with hooks. The hook-based transitions take precedence when they fire, but the output monitor still works for edge cases where hooks don't cover a particular scenario.

## Files to Modify

1. `src/runtime/api-contract.ts` -- add types, extend review reason union
2. `src/runtime/state/workspace-state.ts` -- add "hook" to VALID_REVIEW_REASONS
3. `src/hooks-cli.ts` -- new file, the `kanban hooks ingest` subcommand
4. `src/runtime/terminal/session-manager.ts` -- hook injection in buildLaunchCommand, new public methods, Gemini temp file, Codex "›" detection, cleanup lifecycle
5. `src/cli.ts` -- route hooks subcommand, add /api/hooks/ingest endpoint, pass new fields

## Verification

1. Start kanban, create a task, start it with Claude Code agent
2. Verify that the claude command includes `--settings` with hooks JSON in the spawned PTY
3. When Claude finishes responding (Stop event) or shows a permission prompt (Notification), verify the card moves to Review column automatically
4. When you type a response in the terminal, verify the card moves back to In Progress (via UserPromptSubmit hook)
5. Repeat with Codex: verify `-c 'notify=[...]'` is passed, verify card moves to Review on agent-turn-complete, verify card moves back when you send a message ("›" detection in output)
6. Repeat with Gemini: verify temp config file is created, `--config` is passed, card transitions work, temp file is cleaned up on exit
7. Repeat with OpenCode: verify temp plugin file is created in `.opencode/plugins/`, card transitions work via `session.idle`/`permission.asked`/`permission.replied` events, plugin file is cleaned up on exit
8. Verify Cline falls back to existing output-monitor behavior
9. Run existing tests to ensure nothing is broken
