# Runtime Hooks Architecture

## Purpose

This document explains how Kanban tracks agent session state using runtime hooks.

It focuses on:

1. Launch-time wiring for each agent.
2. The `kanban hooks ...` subcommand pipeline.
3. State transition rules (`running` <-> `awaiting_review`).
4. Generated files under the runtime home directory.
5. Platform behavior differences and why the transport is implemented in Node.

## Scope

This doc covers the runtime terminal agents:

1. Claude
2. Codex
3. Gemini
4. OpenCode

It does not cover adding new agents in detail.

## Quick glossary

1. Board columns:
   1. `in_progress`
   2. `review`
2. Runtime session states:
   1. `running`
   2. `awaiting_review`
3. Hook transition intents:
   1. `to_in_progress`
   2. `to_review`

Important: hook events are transition intents, not direct session state values.

## Why this exists

Each CLI agent exposes different callback surfaces:

1. Some provide direct hook event callbacks.
2. Some provide completion-only callbacks.
3. Some require parsing side-channel logs.

Kanban normalizes all of that into two transition intents:

1. `to_review`
2. `to_in_progress`

That normalization allows a single state machine and consistent board behavior.

## High-level data flow

```text
Terminal session starts
  -> prepareAgentLaunch() builds per-agent command/env/config
  -> agent process emits hook-relevant signals
  -> agent hook/wrapper calls:
       kanban hooks notify --event <to_review|to_in_progress>
  -> notify path dispatches best-effort ingest
       kanban hooks ingest --event <to_review|to_in_progress>
  -> hooks ingest calls runtime TRPC hooks.ingest
  -> hooks API validates transition eligibility
  -> session manager applies reducer transition event
  -> runtime streams updated state to UI
```

## Runtime home directory and generated files

Runtime home root:

```text
~/.kanban
```

Hook-related files live under:

```text
~/.kanban/hooks/<agent-id>/
```

Generated files by agent:

1. Claude
   1. `~/.kanban/hooks/claude/settings.json`
2. Gemini
   1. `~/.kanban/hooks/gemini/settings.json`
3. OpenCode
   1. `~/.kanban/hooks/opencode/kanban.js`
   2. `~/.kanban/hooks/opencode/opencode.json`
4. Codex
   1. No persistent wrapper script file is generated now.
   2. Codex uses `kanban hooks codex-wrapper` as the wrapper command.

Generated hook files are written through idempotent text writes. Files only update when content changes.

## Hook runtime context env vars

When hook context is available, launch wiring injects:

1. `KANBAN_HOOK_TASK_ID`
2. `KANBAN_HOOK_WORKSPACE_ID`
3. `KANBAN_HOOK_PORT`

These are required by `kanban hooks ingest` to route a hook event to the correct session and runtime process.

## Command resolution and cross-platform behavior

Hook commands are not hardcoded as `node dist/cli.js ...`.

Instead, command parts are built from current runtime invocation context:

1. Current node executable (`process.execPath`)
2. Current entrypoint path (`process.argv`)
3. Optional exec args (`process.execArgv`)
4. `tsx` dev mode shape when applicable

This allows hook commands to work from:

1. Published package execution
2. Linked local package
3. Dev mode (`tsx`)
4. Windows and non-Windows shells

## Launch-time wiring per agent

This section describes exactly what `prepareAgentLaunch()` does for each agent.

### Shared behavior

Shared hook context preconditions:

1. `serverPort` must be present and valid.
2. `workspaceId` must be present and non-empty.
3. If either is missing, hook wiring is skipped for that launch.

### Claude

Wiring:

1. Write `~/.kanban/hooks/claude/settings.json`.
2. Pass `--settings <path>` to Claude.
3. Inject `KANBAN_HOOK_*` env vars.

Configured hook mapping in Claude settings:

1. `Stop` -> `to_review`
2. `PermissionRequest` -> `to_review`
3. `Notification(permission_prompt)` -> `to_review`
4. `UserPromptSubmit` -> `to_in_progress`
5. `PostToolUse` -> `to_in_progress`
6. `PostToolUseFailure` -> `to_in_progress`

### Codex

Wiring:

1. Inject `KANBAN_HOOK_*` env vars.
2. Replace spawn target with:

```text
kanban hooks codex-wrapper --real-binary <configured-codex-binary> -- <codex args...>
```

3. Keep prompt-detection fallback for returning from review when Codex prompt reappears.

Codex wrapper behavior:

1. Runs Codex with `-c notify=[...]` so completion emits `to_review`.
2. Enables `CODEX_TUI_RECORD_SESSION=1`.
3. Ensures `CODEX_TUI_SESSION_LOG_PATH` exists (creates temp path when missing).
4. Watches session log file, parses `to_tui codex_event` lines.
5. Maps:
   1. `task_started` -> `to_in_progress`
   2. `exec_command_begin` -> `to_in_progress`
   3. `*_approval_request` -> `to_review`
6. Deduplicates repeated events:
   1. `lastTurnId`
   2. `lastExecCallId`
   3. `lastApprovalId`
7. Handles missing approval identifiers with fallback sequence:
   1. `approval_request_1`, `approval_request_2`, ...

### Gemini

Wiring:

1. Write `~/.kanban/hooks/gemini/settings.json`.
2. Set `GEMINI_CLI_SYSTEM_SETTINGS_PATH=<that file>`.
3. Inject `KANBAN_HOOK_*` env vars.
4. Hook commands in Gemini settings call:

```text
kanban hooks gemini-hook
```

Gemini hook handler behavior:

1. Reads hook payload from stdin.
2. Extracts `hook_event_name`.
3. Writes `{}` to stdout immediately.
4. Maps:
   1. `BeforeAgent` -> `to_in_progress`
   2. `AfterTool` -> `to_in_progress`
   3. `AfterAgent` -> `to_review`
5. Dispatches event asynchronously via notify path.

The immediate stdout response is required to avoid blocking Gemini CLI hook execution.

### OpenCode

Wiring:

1. Generate plugin file at `~/.kanban/hooks/opencode/kanban.js`.
2. Generate OpenCode config at `~/.kanban/hooks/opencode/opencode.json`.
3. Set `OPENCODE_CONFIG=<generated config path>`.
4. Inject `KANBAN_HOOK_*` env vars.

Plugin behavior:

1. Filters child sessions, only tracks root session.
2. Tracks busy/idle transitions with local state.
3. Maps busy activity to `to_in_progress`.
4. Maps idle/error and `permission.ask` to `to_review`.
5. Uses best-effort command execution to avoid disrupting OpenCode.

## Hooks CLI subcommands deep dive

`src/hooks-cli.ts` is the hook transport control plane.

### `hooks ingest`

Behavior:

1. Parse `--event`.
2. Parse `KANBAN_HOOK_*` env context.
3. Call TRPC mutation `hooks.ingest` with timeout.
4. Return non-zero on ingest failure.

Use case:

1. Strict path when caller needs explicit ingest success/failure.

### `hooks notify`

Behavior:

1. Uses same parse + ingest pipeline.
2. Swallows errors by design.

Use case:

1. Agent callback paths where failures must never break the agent run.

### `hooks gemini-hook`

Behavior:

1. Parse stdin JSON.
2. Emit required `{}` response.
3. Map and dispatch transition intent through notify.

### `hooks codex-wrapper`

Behavior:

1. Parse `--real-binary`.
2. Spawn Codex with notify callback.
3. Start log watcher when hook env is present.
4. Parse session log lines and map normalized events.
5. Forward signals (`SIGINT`, `SIGTERM`) to Codex child process.
6. Stop watcher on child exit/error.

## Transition application and guard rules

The runtime reducer accepts:

1. `hook.to_review`
2. `hook.to_in_progress`
3. `agent.prompt-ready`
4. `process.exit`

Reducer rules:

1. `hook.to_review` only transitions when current state is `running`.
2. `hook.to_in_progress` only transitions when current state is `awaiting_review` and reason is `hook` or `attention`.
3. Non-eligible transitions are ignored.

Hooks API rules:

1. Ineligible transitions return `ok: true` (no-op success).
2. Eligible transitions update state and broadcast updates.
3. `to_review` emits `task_ready_for_review` stream event.

Why no-op success is important:

1. Hook signals can repeat.
2. Hook signals can arrive late.
3. Agents can emit overlapping events from different callbacks.
4. No-op success prevents error spam and state flapping.

## Temporary and runtime-only artifacts

Codex wrapper may create a runtime session log path when absent:

```text
<tmpdir>/kanban-codex-session-<pid>_<timestamp>.jsonl
```

This file is a runtime artifact used for watcher parsing, not a persistent config file.

## Plan mode interactions

Hook wiring is orthogonal to plan mode, but plan mode still adjusts agent launch args:

1. Claude plan mode adjusts permission flags.
2. Codex prepends `/plan` to initial prompt when prompt exists.
3. Gemini adds `--approval-mode=plan`.
4. OpenCode sets `OPENCODE_EXPERIMENTAL_PLAN_MODE=true` and `--agent plan` when needed.

## Failure model

Design principle:

1. Hook transport failures should not terminate agent processes.

Concrete behavior:

1. `notify` is best-effort and swallows exceptions.
2. Wrapper/plugin hook invocations are detached or non-blocking where possible.
3. `ingest` is strict, but normally called from notify wrappers that isolate failures.

## Debugging guide

When transitions are missing:

1. Confirm hook env variables exist inside launched agent process.
2. Confirm expected generated files exist under `~/.kanban/hooks`.
3. Run `kanban hooks ingest --event to_review` manually with env vars set.
4. For Codex:
   1. Check `CODEX_TUI_SESSION_LOG_PATH`.
   2. Confirm log lines contain `dir=to_tui` and `kind=codex_event`.
5. For Gemini:
   1. Confirm `GEMINI_CLI_SYSTEM_SETTINGS_PATH` points to generated settings.
   2. Confirm hook command is `kanban hooks gemini-hook`.
6. For OpenCode:
   1. Confirm `OPENCODE_CONFIG` points to generated config.
   2. Confirm plugin file URL references generated plugin.

When transitions are noisy:

1. Verify runtime guard rules are in effect.
2. Check Codex dedupe IDs (`turn_id`, `call_id`, approval identifiers).
3. Confirm no extra stale global configs are overriding generated config paths.

## Test coverage map

Existing tests include:

1. Runtime API validation of hook ingest payloads.
2. Hooks API transition behavior and no-op semantics.
3. Agent adapter wiring output (settings/config/plugin generation and launch command construction).
4. Session manager transition behavior.
5. Integration coverage for `hooks.ingest` state-stream effects.

## Design constraints that shaped this implementation

1. Must work in `npx` workflows where Node is guaranteed.
2. Must work on Windows and non-Windows without shell-specific dependencies.
3. Must avoid blocking or crashing agent runs due to hook transport failures.
4. Must tolerate duplicate and out-of-order hook signals.
5. Must keep agent-specific complexity at adapter/wrapper boundaries while preserving one runtime state model.
