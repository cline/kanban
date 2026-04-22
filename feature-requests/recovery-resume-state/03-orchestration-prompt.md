# Recovery Resume State Orchestration Prompt

Branch:
- `fork/feature-request/recovery-resume-state`

Objective:
- implement a fork-only behavior change that replaces upstream's trash-oriented interruption model with an in-place resumable recovery model

Before changing code:
- review the latest upstream changes in touched areas
- pay special attention to recent recovery/session commits around trash resume and session reload stability

Locked decisions:
- interrupted tasks stay in place
- preserve interrupted task worktrees
- v1 guarantees clean restart only
- no auto-resume on boot
- no new external API

Constraints:
- do not widen scope into scheduler, queue, or persistence redesign
- do not add hard-crash guarantees
- preserve existing non-recovery behavior where possible
- do not reintroduce any path where interrupted implicitly means trash

Delegation map:
- `gpt-5.4-mini` low
  - docs
  - audits
  - count/read-model adjustments
  - narrow UI copy/affordance work
- `gpt-5.4-mini` medium
  - shutdown semantics
  - startup reconciliation
  - board interaction changes
  - resume action wiring
- `gpt-5.4-medium` or `gpt-5.3-codex` medium
  - broad regression/integration test wave

Validation gates:
1. Backend semantics gate
- clean shutdown persists interrupted in place
- interrupted task worktrees are preserved

2. Startup snapshot gate
- first post-restart snapshot is correct before websocket attach

3. UI affordance gate
- interrupted tasks are visibly resumable in board/detail surfaces

4. End-to-end resume gate
- terminal-backed tasks can be resumed through existing runtime paths

Required worker output:
- files changed
- tests added or updated
- assumptions made
- open risks

Execution order:
1. semantics audit
2. shutdown change
3. startup reconciliation
4. explicit Cline non-goal check
5. counts/read consistency
6. board behavior
7. UI affordance
8. resume wiring
9. test wave
10. final audit

Definition of done:
- interrupted tasks remain in place after clean restart
- preserved worktrees survive interruption
- first snapshot is correct
- interrupted tasks are not counted as trash
- operator can explicitly resume interrupted tasks
