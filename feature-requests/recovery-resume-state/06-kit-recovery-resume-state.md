# Kit: Recovery Resume State

## Summary

Implement a fork-only recovery feature so tasks interrupted by clean shutdown or orderly restart remain in place, preserve their worktrees, surface as resumable, and can be resumed explicitly after restart without relying on trash semantics.

## Scope

This kit covers:
- shutdown interruption semantics
- startup reconciliation
- terminal stale-session normalization
- in-place interrupted UI state
- explicit resume affordances
- project/read-model consistency

This kit does not cover:
- hard-crash guarantees
- auto-resume on boot
- scheduler or queueing changes
- new public integration APIs
- generalized persistence redesign

## Requirements

### R1. Interrupted tasks remain in place

After clean shutdown or orderly restart, tasks previously active in `backlog`, `in_progress`, or `review` remain in their existing board column and are not moved to `trash` solely because they were interrupted.

Acceptance criteria:
- AC1: clean shutdown of a running terminal task does not move its card to `trash`
- AC2: clean shutdown of an awaiting-review terminal task does not move its card to `trash`
- AC3: board hydration after restart does not auto-move interrupted tasks to `trash`

### R2. Interrupted tasks preserve worktrees

Tasks interrupted during clean shutdown keep their task worktrees so resumed execution can continue against preserved context.

Acceptance criteria:
- AC1: shutdown cleanup does not delete interrupted task worktrees
- AC2: resume flow reuses the preserved worktree rather than forcing cleanup-and-recreate semantics

### R3. First restart snapshot is authoritative

After restart, the first workspace snapshot exposed to clients reflects interrupted state correctly before terminal websocket attach or manual repair actions.

Acceptance criteria:
- AC1: stale persisted `running` or `awaiting_review` terminal summaries are normalized before first outward snapshot
- AC2: counts and summaries do not depend on websocket attach to become correct

### R4. Native Cline remains unchanged

This branch does not modify native Cline SDK behavior or Kanban's `src/cline-sdk/` boundary.

Acceptance criteria:
- AC1: no branch code changes land under `src/cline-sdk/`
- AC2: interrupted/resume behavior added by this branch is limited to terminal-backed tasks

### R5. Interrupted tasks surface explicit resume affordances

Interrupted tasks must be visibly resumable in the board and/or detail flow, and must not be presented as implicitly trashed.

Acceptance criteria:
- AC1: interrupted task shows distinct status from `failed`
- AC2: operator has an explicit `Resume` action without using trash restore semantics
- AC3: resume action uses existing runtime behavior rather than inventing a new recovery protocol

### R6. Read-side models stay consistent

Project summaries, board state, and session summaries remain internally consistent under the new interruption model.

Acceptance criteria:
- AC1: interrupted tasks are not counted as `trash`
- AC2: project navigation counts match actual board placement after restart
- AC3: board/session state does not oscillate due to stale summary replay

## Dependencies

- depends on existing terminal session summaries and startup hydration
- depends on existing UI task start/session hooks

## Cross references

- refs: `05-refs-existing-behavior.md`
- scope: `01-scope.md`
- plan: `02-ticket-index.md`
- validation: `07-validation.md`
- tracking: `08-tracking.md`
