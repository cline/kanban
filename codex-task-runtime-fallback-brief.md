# Codex task runtime fallback brief

## Summary

- add local fallback for board-focused `kanban task` commands when runtime transport is unavailable
- keep runtime-backed behavior unchanged when the runtime is reachable
- return a clearer explicit error for `kanban task start` when the runtime is unreachable
- add integration coverage for the fallback slice

## Validation status

- implementation is in place in `src/commands/task.ts`
- integration coverage was added in `test/integration/task-command-exit.integration.test.ts`
- full local validation is currently blocked in this environment because dependency install fails for `@anthropic-ai/claude-agent-sdk@0.2.88`

## Reviewer focus

Please verify:

1. dependency install works in a normal maintainer environment
2. targeted typecheck/tests pass
3. sandboxed Codex task sessions can use board-only task commands via fallback
4. normal host-shell runtime-backed behavior still works unchanged

## Problem

`kanban task ...` commands currently assume the calling process can always reach the Kanban runtime over local HTTP, typically at:

- `http://127.0.0.1:3484/api/trpc`

That assumption breaks inside spawned Codex task sessions when networking is sandboxed or loopback access is blocked. In that environment, the Kanban CLI binary, PATH, and working directory can all be correct, but runtime-backed task commands still fail because the CLI cannot reach the runtime transport.

## Why this matters

This makes Codex task sessions much less useful for normal board maintenance. A spawned Codex session may be unable to do common task operations like:

- listing tasks
- creating tasks
- updating tasks
- linking tasks
- unlinking tasks

even though those commands only need persisted board state and do not always require live runtime side effects.

## Intended fix

The current fix keeps the existing runtime/TRPC path when the runtime is reachable, but adds a safe local fallback for board-focused commands when runtime transport is unavailable.

### Commands that should fall back to local persisted workspace state

- `kanban task list`
- `kanban task create`
- `kanban task update`
- `kanban task link`
- `kanban task unlink`

When fallback is used, the command should still succeed and return metadata that makes the degraded mode explicit:

- `runtimeAvailable: false`
- warning text explaining the runtime was unreachable and local workspace state was used instead

### Commands that should remain runtime-required for now

- `kanban task start`
- `kanban task trash`
- `kanban task delete`

These flows still depend on runtime-owned side effects such as starting or stopping live sessions, worktree lifecycle management, and related orchestration.

For this first slice, `task start` should fail with a clear, explicit message instead of a generic fetch/network error when the runtime is unreachable.

## Scope of the current patch

This patch is intentionally the smallest safe step:

1. preserve normal runtime-backed behavior when the runtime is reachable
2. add local fallback for board-only commands
3. improve the `task start` failure message when runtime access is unavailable
4. avoid broader architectural changes like introducing a new bridge or IPC transport in this PR

## Current status

- Runtime fallback behavior is implemented in `src/commands/task.ts`
- Integration coverage for the fallback slice was added in `test/integration/task-command-exit.integration.test.ts`
- Full local validation is still blocked in this environment because root dependency install currently fails

## Known validation blocker

`npm ci` currently fails because the lockfile points at a tarball URL for:

- `@anthropic-ai/claude-agent-sdk@0.2.88`

and that registry URL returns `404` in this environment. Until that dependency issue is resolved, local `typecheck` and Vitest execution cannot be completed here.

## What the Cline team should test next

1. Restore a working dependency install
2. Run typecheck and targeted tests
3. Manually verify behavior in a sandboxed Codex session
4. Confirm host-shell runtime-backed behavior still works unchanged
