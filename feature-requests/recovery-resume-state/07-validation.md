# Validation

Build command:
- use Kanban's existing project build/typecheck command for Gate 1 during implementation

Test command:
- use Kanban's existing targeted Vitest/integration commands for Gates 2 and 3 during implementation

## Gate map

### Gate 1: Compilation / typecheck

Applies to:
- R1
- R2
- R3
- R4
- R5
- R6

Pass condition:
- changed code compiles and typechecks with no new errors in touched areas

### Gate 2: Targeted unit and module tests

Applies to:
- terminal session manager changes
- board interaction changes
- project count changes

Pass condition:
- updated runtime and web-ui tests covering the changed behaviors pass

### Gate 3: Integration behavior

Applies to:
- shutdown behavior
- startup reconciliation
- cross-layer resume flow

Required scenarios:
1. clean shutdown of running terminal task
2. clean shutdown of awaiting-review terminal task
3. restart-time snapshot correctness before websocket attach
4. interrupted terminal task resume flow from UI/runtime path
5. count consistency after restart

### Gate 4: Resource / speed

Not a primary gate for v1 unless implementation changes introduce measurable startup regression.

Optional checks:
- no obvious startup reconciliation slowdown across normal workspace boot

### Gate 5: Startup smoke

Pass condition:
- Kanban boots
- workspace state loads
- first task/session snapshot is coherent
- no startup-time fatal error introduced by recovery reconciliation

### Gate 6: Manual audit

Audit questions:
1. does interrupted now clearly mean resumable rather than trashed?
2. is the branch still narrow and fork-safe?
3. are any trash-oriented assumptions left behind in touched code paths?
4. does the resume UX stay limited to terminal-backed tasks?

## Requirement-to-test mapping

### R1
- shutdown integration test
- board interaction tests for interrupted hydration/update

### R2
- shutdown integration test with worktree preservation assertions
- resume path test proving preserved worktree reuse

### R3
- startup/workspace snapshot test
- terminal manager or workspace registry test proving no websocket-attach dependency

### R4
- audit that no new native Cline behavior is introduced

### R5
- board card/detail panel UI tests
- task session action hook test for explicit resume path

### R6
- project count tests
- monotonic session merge regression coverage

## Completion signal

This branch is not complete until:
- all applicable gates pass
- manual audit confirms no remaining interrupted-to-trash semantic leak in changed areas
