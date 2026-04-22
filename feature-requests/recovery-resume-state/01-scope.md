# Scope

## Summary

Implement a fork-only behavior change so tasks interrupted by clean shutdown or orderly restart remain in place, are marked resumable, preserve their worktrees, and can be resumed explicitly by the operator after restart.

## Current upstream behavior

Confirmed upstream assumptions:
- shutdown cleanup marks active sessions as interrupted
- shutdown cleanup moves interrupted tasks to `trash`
- shutdown cleanup deletes task worktrees selected for cleanup
- project counts treat interrupted non-trash tasks as effectively trash-bound
- board logic auto-moves interrupted tasks to `trash`
- terminal stale-session normalization exists, but it is triggered on websocket attach
- native Cline persisted-session behavior exists upstream, but this branch does not modify it

## Target behavior

After a clean restart:
- a previously active task remains in its original column
- its session summary is `state: "interrupted"` and `reviewReason: "interrupted"`
- its worktree remains available
- the first workspace snapshot already reflects the interrupted state
- the operator sees an explicit `Resume` affordance
- resume uses existing runtime paths:
  - terminal agents restart as fresh processes against preserved worktree state

## In scope

- change shutdown interruption persistence semantics
- change startup reconciliation semantics
- remove interrupted-to-trash auto-moves
- add interrupted/resume UI affordances
- update count/read models that assume interrupted means trash
- add regression and integration coverage

## Explicit non-goal

- do not modify native Cline SDK behavior or Kanban's `src/cline-sdk/` boundary

## Out of scope

- hard-crash guarantees
- kill -9 or power-loss recovery guarantees
- auto-resume on boot
- new public task ingest/import API
- new persistence store or board format
- broad task workflow redesign outside interruption/recovery

## Acceptance criteria

1. Clean shutdown of a running or review task persists it as interrupted in place.
2. Interrupted tasks are not moved to `trash` by backend or board automation.
3. Interrupted task worktrees are preserved across clean restart.
4. First post-restart snapshot is correct before terminal websocket attach.
5. Operator can resume interrupted terminal-backed tasks from the board/detail flow.
6. Project counts no longer classify interrupted tasks as trash.

## Risks

- upstream currently encodes trash-oriented interruption assumptions in multiple layers
- recent upstream recovery changes increase merge-drift risk in touched files
- preserving worktrees changes operational cleanup behavior and needs explicit regression coverage
