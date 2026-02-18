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

## Next Up
1. Wire real CLI boot path so `kanbanana` serves and opens the web app.
2. Replace mock ACP runner with real ACP subprocess transport for initial provider.
3. Add runtime API for real file tree and git diff data from the active task workspace.

## Open Decisions
1. Exact keyboard command for global search palette in phase 09.
2. Initial shape of minimal usage/subscription placeholder in phase 11.
3. Default behavior when ACP provider is installed but unauthenticated.

## Blockers
- None currently.

## Resume From Here
- Continue with `01-acp-kanban-shell`, focusing next on runtime/CLI integration and real ACP transport.
