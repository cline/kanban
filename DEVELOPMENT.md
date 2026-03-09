# Development

## Requirements

- Node.js 20+
- npm 10+

## Install

```bash
npm run install:all
```

## Hot reload workflow

Run two terminals:

1. Runtime server (API + PTY agent runtime):

```bash
npm run dev
```

- Runs on `http://127.0.0.1:8484`

2. Web UI (Vite HMR):

```bash
npm run web:dev
```

- Runs on `http://127.0.0.1:4173`
- `/api/*` requests from Vite are proxied to `http://127.0.0.1:8484`

Use `http://127.0.0.1:4173` while developing UI so changes hot reload.

## Build and run packaged CLI

```bash
npm run build
node dist/cli.js
```

This mode serves built web assets from `dist/web-ui` and does not hot reload the web UI.

## Run `kanban` from any directory

After cloning and installing dependencies, create/update the global CLI link from this repo:

```bash
npm run link
```

Verify:

```bash
which kanban
kanban --version
```

Then run from any project directory:

```bash
cd /path/to/your/project
kanban
```

After local code changes, run `npm run build` again before using the linked command.

When switching between worktrees, re-run `npm run link` from the worktree you want to test so the global `kanban` binary points at the right `dist/cli.js`. Without this, `kanban mcp` will serve a stale build from a different worktree.

Remove the global link:

```bash
npm run unlink
```

## Scripts

- `npm run build`: build runtime and bundled web UI into `dist`
- `npm run dev`: run CLI in watch mode
- `npm run web:dev`: run web UI dev server
- `npm run web:build`: build web UI
- `npm run typecheck`: typecheck runtime
- `npm run web:typecheck`: typecheck web UI
- `npm run test`: run runtime tests
- `npm run web:test`: run web UI tests
- `npm run check`: lint, typecheck, and test runtime package

## Tests

- `test/integration`: integration tests for runtime behavior and startup flows
- `test/runtime`: runtime unit tests
- `test/utilities`: shared test helpers

## Agent tracking and runtime hooks

Kanban tracks agent session state with runtime hook events. The core transition model is:

- `in_progress -> review`
- `review -> in_progress`

Internal runtime session states are named `running` and `awaiting_review`, and hook events are transition intents:

- `to_in_progress` for `review -> in_progress`
- `to_review` for `in_progress -> review`

How it works end to end:

1. `prepareAgentLaunch` wires each agent with hook commands or hook-aware wrappers.
2. Hook handlers call `kanban hooks ...` subcommands.
3. `kanban hooks ingest --event <to_review|to_in_progress>` reads hook context from env:
   - `KANBAN_HOOK_TASK_ID`
   - `KANBAN_HOOK_WORKSPACE_ID`
   - `KANBAN_HOOK_PORT`
4. The ingest command calls runtime TRPC `hooks.ingest`.
5. The runtime applies guarded transitions and ignores duplicates or invalid transitions as no-ops.

Current agent mappings:

- Claude
  - `UserPromptSubmit`, `PostToolUse`, `PostToolUseFailure` emit `to_in_progress`
  - `Stop`, `PermissionRequest`, and `Notification` with `permission_prompt` emit `to_review`
- Codex
  - wrapper enables TUI session logging and maps:
    - `task_started` and `exec_command_begin` to `to_in_progress`
    - `*_approval_request` to `to_review`
  - Codex `notify` completion path also emits `to_review`
- Gemini
  - `BeforeAgent` and `AfterTool` emit `to_in_progress`
  - `AfterAgent` emits `to_review`
  - hook command writes `{}` to stdout immediately to satisfy Gemini hook contract, then notifies in background
- OpenCode
  - plugin maps busy activity to `to_in_progress`
  - plugin maps idle/error and permission ask to `to_review`
  - plugin filters child sessions to avoid false transitions from nested runs

Important behavior details:

- Hooks are best-effort and should not crash or block the underlying agent process.
- Hook notify paths are asynchronous to keep agent UX responsive.
- Runtime transition guards are authoritative and prevent state flapping from duplicate events.
- Hook transport is implemented in Node and invoked through `kanban hooks ...`, so the behavior is consistent across Windows and non-Windows environments.

For a full technical breakdown, see:

- `.plan/docs/runtime-hooks-architecture.md`

## PostHog telemetry config

The web UI reads PostHog settings at build time:

- `POSTHOG_KEY`
- `POSTHOG_HOST`

Local development:
- Set these in `web-ui/.env.local` (see `web-ui/.env.example`).
- If `POSTHOG_KEY` is missing, telemetry does not initialize.

Release builds:
- The publish workflow injects `POSTHOG_KEY` and `POSTHOG_HOST` from GitHub Secrets.
- `POSTHOG_HOST` is optional and defaults to `https://data.cline.bot`.

Result:
- Official releases have telemetry enabled.
- Forks and source builds have telemetry disabled unless a key is explicitly provided.
