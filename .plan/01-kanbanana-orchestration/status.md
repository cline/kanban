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
- Added project-level runtime ACP setup API and UI dialog so ACP command can be configured without manual env setup.
- Mapped implementation direction to `vibe-kanban` split-pane/task-detail patterns while keeping scope local-first and minimal.

## Next Up
1. Run one real ACP provider end-to-end validation using `KANBANANA_ACP_COMMAND`.
2. Start phase `02-runtime-reliability` (timeouts, stuck-task handling, clearer recoverability UX).
3. Prepare task-scoped workspace paths so runtime workspace changes can switch from repo-root to worktree-aware scope in phase 03.

## Open Decisions
1. Exact keyboard command for global search palette in phase 09.
2. Initial shape of minimal usage/subscription placeholder in phase 11.
3. Default behavior when ACP provider is installed but unauthenticated.

## Blockers
- None currently.

## Resume From Here
- Continue with `01-acp-kanban-shell` for one final real-provider validation pass, then advance to `02-runtime-reliability`.
