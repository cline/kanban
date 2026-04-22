# Ticket Index

Branch:
- `fork/feature-request/recovery-resume-state`

Execution order:
1. Ticket 00
2. Ticket 01
3. Ticket 02
4. Ticket 03
5. Ticket 04
6. Ticket 08
7. Ticket 05
8. Ticket 06
9. Ticket 07
10. Ticket 09
11. Ticket 10

## Ticket 00: Feature folder scaffolding and control docs

Recommended model:
- `gpt-5.4-mini` low

Deliverables:
- this folder and control docs

Done when:
- branch name, locked decisions, scope, and delegation map are documented

## Ticket 01: Recovery semantics audit and drift map

Recommended model:
- `gpt-5.4-mini` medium

Purpose:
- enumerate every place where `interrupted` currently implies `trash`, cleanup, or non-resumable state

Required focus:
- `src/server/shutdown-coordinator.ts`
- `src/server/workspace-registry.ts`
- `src/terminal/session-manager.ts`
- `src/trpc/runtime-api.ts`
- `web-ui/src/hooks/use-board-interactions.ts`
- tests encoding interruption semantics

Done when:
- audit documents all relevant assumptions and recent upstream changes in touched areas

## Ticket 02: Shutdown cleanup behavior change

Recommended model:
- `gpt-5.4-mini` medium

Purpose:
- stop moving interrupted tasks to `trash`
- stop deleting interrupted task worktrees
- persist interrupted summaries in place

Done when:
- clean shutdown leaves tasks in place and preserves worktrees

## Ticket 03: Startup reconciliation for terminal sessions

Recommended model:
- `gpt-5.4-mini` medium

Purpose:
- normalize stale terminal session state during workspace/service startup
- remove dependency on terminal websocket attach for correctness

Done when:
- first outward snapshot after restart reflects interrupted state, not stale running/review

## Ticket 04: Native Cline explicit non-goal audit

Recommended model:
- `gpt-5.4-mini` low

Purpose:
- confirm the branch does not modify native Cline SDK behavior

Done when:
- no edits land under `src/cline-sdk/`
- feature docs clearly state native Cline is out of scope

## Ticket 05: Board interaction behavior change

Recommended model:
- `gpt-5.4-mini` medium

Purpose:
- remove board automation that sends interrupted tasks to `trash`

Done when:
- interrupted tasks remain in place during hydration and live session updates

## Ticket 06: Resume affordance on board/detail surfaces

Recommended model:
- `gpt-5.4-mini` medium

Purpose:
- make interrupted tasks visibly resumable

Done when:
- board card and/or detail panel show explicit interrupted/resume state and action

## Ticket 07: Resume action wiring

Recommended model:
- `gpt-5.4-mini` medium

Purpose:
- wire explicit resume action into existing start/rebind runtime paths

Done when:
- terminal tasks resume on preserved worktree

## Ticket 08: Project counts and read-side consistency

Recommended model:
- `gpt-5.4-mini` low

Purpose:
- update counts/read models that currently classify interrupted tasks as trash

Done when:
- project nav and summaries match actual board placement

## Ticket 09: Regression and integration test wave

Recommended model:
- `gpt-5.3-codex` medium

Purpose:
- validate the end-to-end restart and resume behavior

Required scenarios:
- running terminal task interrupted by clean shutdown
- review terminal task interrupted by clean shutdown
- first snapshot is correct before websocket attach
- interrupted task resume path works
- interrupted tasks are not counted as trash
- worktrees are preserved

Done when:
- integrated recovery behavior is pinned by tests

## Ticket 10: Final integration audit

Recommended model:
- `gpt-5.4-mini` low

Purpose:
- verify narrow scope, residual drift, and leftover trash-oriented assumptions

Done when:
- final validation notes are written and no unaccounted interruption assumptions remain
