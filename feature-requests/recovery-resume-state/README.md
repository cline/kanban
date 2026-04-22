# Recovery Resume State

Branch:
- `fork/feature-request/recovery-resume-state`

Goal:
- change interrupted-task recovery from upstream's trash-oriented model to an in-place resumable model

Locked decisions:
- interrupted tasks stay in their current column
- interrupted task worktrees are preserved
- v1 guarantees clean restart only
- no auto-resume on boot
- no new external API

Why this branch exists:
- upstream already has partial recovery machinery
- shutdown interruption, stale-session repair, and trash-resume flows exist
- the missing capability is deterministic restart recovery with a coherent operator-facing resume path

What changes in this fork:
- `interrupted` no longer implies `trash`
- clean shutdown no longer deletes interrupted task worktrees
- startup reconciliation corrects stale session state before first outward snapshot
- UI exposes interrupted tasks as resumable in place

Primary implementation areas:
- shutdown cleanup
- workspace startup reconciliation
- terminal stale-session normalization
- native Cline explicitly out of scope
- board interaction behavior
- resume affordances and wiring
- counts and read-side consistency

Non-goals:
- hard-crash or power-loss guarantees
- automatic task restart on boot
- full terminal process resurrection
- generalized persistence redesign
- scheduler, queue, or routing expansion

Required validation:
- interrupted tasks remain in place after clean restart
- worktrees survive interruption
- first snapshot after restart is correct without websocket attach
- native Cline behavior remains unchanged
- interrupted tasks are not counted as trash

Docs in this folder:
- `01-scope.md`
- `02-ticket-index.md`
- `03-orchestration-prompt.md`
- `04-context-index.md`
- `05-refs-existing-behavior.md`
- `06-kit-recovery-resume-state.md`
- `07-validation.md`
- `08-tracking.md`
