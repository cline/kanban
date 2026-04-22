# Refs: Existing Behavior

## Brownfield baseline

This feature is a brownfield adoption on top of the existing Kanban codebase.
The current source is the reference material. The fork feature must be framed as
a narrow delta against confirmed current behavior.

## Confirmed upstream behavior

### Shutdown

- clean shutdown marks active sessions as interrupted
- clean shutdown moves interrupted tasks to `trash`
- clean shutdown can delete task worktrees selected for cleanup

Primary files:
- `/lump/apps/kanban/src/server/shutdown-coordinator.ts`

### Terminal runtime

- terminal sessions support in-memory auto-restart while the process is still alive
- stale session repair exists through `recoverStaleSession()`
- stale session repair currently happens on terminal websocket attach, not as a general boot-time sweep

Primary files:
- `/lump/apps/kanban/src/terminal/session-manager.ts`
- `/lump/apps/kanban/src/terminal/ws-server.ts`

### Workspace startup and counts

- workspace managers hydrate persisted session summaries
- project counts currently treat interrupted non-trash tasks as effectively trash-bound

Primary files:
- `/lump/apps/kanban/src/server/workspace-registry.ts`

### Cline recovery

- persisted Cline sessions can be rebound after restart
- runtime APIs already use reload and persisted-session rebind flows
- `restartTaskSession()` is not restart-safe because prior launch config is in-memory only

Primary files:
- `/lump/apps/kanban/src/cline-sdk/cline-session-runtime.ts`
- `/lump/apps/kanban/src/cline-sdk/cline-task-session-service.ts`
- `/lump/apps/kanban/src/trpc/runtime-api.ts`

### Board behavior

- board automation currently moves interrupted tasks to `trash`
- UI already supports trash-based resume flows
- UI session merge logic already protects against stale summary overwrite

Primary files:
- `/lump/apps/kanban/web-ui/src/hooks/use-board-interactions.ts`
- `/lump/apps/kanban/web-ui/src/hooks/use-task-sessions.ts`
- `/lump/apps/kanban/web-ui/src/components/board-card.tsx`
- `/lump/apps/kanban/web-ui/src/components/detail-panels/agent-terminal-panel.tsx`

## Recent upstream changes relevant to drift

Recent commits observed in touched areas:
- `92e3b55` `fix: stabilize cline provider switching and session reloads`
- `b52dba9` `fix: resume home Cline chats from persisted history`
- `83f750b` `fix: reinitialize task chat state on trash resume`

Implementation rule:
- these areas must be re-reviewed before code changes in each delegated execution pass

## Fork delta this feature introduces

The fork intentionally changes these upstream assumptions:

1. interrupted no longer implies trash
2. clean shutdown no longer deletes interrupted task worktrees
3. startup reconciliation must happen before first outward snapshot
4. interrupted tasks must be resumable in place

## Constraints from current code

- no new external API is required for v1
- existing runtime/trpc surfaces should be reused
- no claim of hard-crash recovery should be made
- terminal process resurrection is not required for v1
- Cline resume should rely on persisted-session rebind, not new launch-config persistence
