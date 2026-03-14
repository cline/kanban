# Dogfood shutdown cleanup handoff plan

## Goal

Prevent `Ctrl+C` on dogfood runs from trashing tasks or deleting task worktrees.

## Confirmed root cause

- `npm run dogfood` often launches a second Kanban runtime.
- Shutdown cleanup marks running and review sessions interrupted, moves cards to trash, and can delete task worktrees.
- For dogfooding, this shutdown behavior is too destructive.

## Final approach

Use an explicit runtime flag instead of sibling process detection.

- Add CLI option: `--skip-shutdown-cleanup`
- When set, runtime shutdown skips session interruption persistence and worktree deletion
- `scripts/dogfood.mjs` always passes this flag when launching `dist/cli.js`

This keeps normal Kanban behavior unchanged, while making dogfood deterministic and safe.

## Supporting behavior

- Keep terminal stale session recovery:
  - if a summary is active but PTY is gone, reset to `idle`
  - terminal can reopen as a fresh shell session

## Tests

- Integration coverage verifies cleanup is skipped when `--skip-shutdown-cleanup` is enabled
- Existing shutdown tests still verify normal cleanup behavior when flag is not set
- Runtime terminal unit test verifies stale session recovery

## Files changed

- `src/cli.ts`
- `scripts/dogfood.mjs`
- `src/server/shutdown-coordinator.ts`
- `src/terminal/session-manager.ts`
- `src/terminal/terminal-session-service.ts`
- `src/terminal/ws-server.ts`
- `test/integration/runtime-state-stream.integration.test.ts`
- `test/runtime/terminal/session-manager.test.ts`

## Validation checklist

- `npm run lint`
- `npm run typecheck`
- `npm run test`
