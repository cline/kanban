# Status

## Current State
- Body of work: `01-kanbanana-orchestration`
- Active phase: `01-acp-kanban-shell`
- Overall progress: in progress

## Completed
- Rebuilt PSN structure from scratch based on updated priorities.
- Defined ordered phase breakdown with clear separation for context, dependencies, and decomposition.
- Implemented functional Kanban UI slice with task CRUD, drag/drop lifecycle, task-scoped chat sessions, and persisted board/session state.
- Added ACP adapter interface with working mock turn runner and wired in-progress to ready-for-review automation.
- Implemented functional task diff and file panels from ACP tool-call artifacts.
- Added CLI local runtime launch path that serves the built web UI and opens browser from `kanbanana`.
- Added runtime ACP API routes and ACP SDK subprocess turn execution path with browser-side fallback.
- Added persistent task-scoped ACP runtime sessions with turn reuse and server-side cancellation.
- Added runtime git-backed workspace changes API and wired detail diff/file panels to runtime-first data.
- Added lightweight ACP command detection signal in health endpoint and top bar runtime mode hint.
- Added runtime ACP setup API and UI dialog so ACP command can be configured without manual env setup, persisted in global `~/.kanbanana/config.json`.
- Added runtime error handling so ACP failures surface in chat and only true runtime-unavailable cases fall back to mock.
- Pulled forward keyboard-first baseline: command palette task search/open (`Cmd/Ctrl+K`), quick-create (`C`), and detail arrow navigation.
- Added shared project shortcut config, editable shortcut buttons, runtime shortcut execution, and inline output preview.
- Mapped implementation direction to `vibe-kanban` split-pane/task-detail patterns while keeping scope local-first and minimal.
- Removed seeded board demo data and migrated legacy localStorage seed cards out of persisted board state.
- Changed kickoff behavior so tasks moved out of Backlog into active columns auto-start ACP runs.
- Removed browser-side mock ACP fallback and now surface runtime misconfiguration/network issues directly in task chat.
- Expanded runtime settings/config to enumerate supported ACP agents with installed/configured status and effective command visibility.
- Added Playwright smoke coverage for empty-board task creation/opening flow and the settings button dialog path.

## Next Up
1. Run one real ACP provider end-to-end validation using `KANBANANA_ACP_COMMAND`.
2. Start phase `02-runtime-reliability` (timeouts, stuck-task handling, clearer recoverability UX).
3. Prepare task-scoped workspace paths so runtime workspace changes can switch from repo-root to worktree-aware scope in phase 03.

## Open Decisions
1. Initial shape of minimal usage/subscription placeholder in phase 11.
2. Default behavior when ACP provider is installed but unauthenticated.

## Blockers
- None currently.

## Resume From Here
- Continue with `01-acp-kanban-shell` for one final real-provider validation pass, then advance to `02-runtime-reliability`.
