# Git view follow-up work

## Goal

Track post-v1 hardening work for the new Git view so behavior is predictable in edge cases and easier to use at scale.

## Priority follow-ups

### P1: Surface real errors for invalid commit diff requests

- Problem: `getCommitDiff` currently returns `ok: true` with an empty `files` array when the commit hash is invalid.
- Risk: users can see misleading "No changes" states instead of actionable failures.
- Follow-up:
  - propagate backend command errors when commit resolution fails
  - return `ok: false` with a clear `error` message
  - show an error UI state in the diff panel

### P1: Support merge commit diffs

- Problem: merge commit diff loading can produce empty file lists.
- Risk: important history appears incomplete.
- Follow-up:
  - update runtime merge diff extraction strategy to handle merge commits explicitly
  - add runtime tests that assert non-empty merge diff output for known merge scenarios

### P2: Keep commits with empty subjects in log parsing

- Problem: commits with empty subject lines are currently dropped during parsing.
- Risk: commit history can be incomplete and pagination counts can feel inconsistent.
- Follow-up:
  - relax commit-record validation to allow empty `message`
  - add a runtime test for empty-subject commit retention

### P2: Improve branch switch discoverability in the new UI flow

- Problem: branch switching now relies on double-click in refs.
- Risk: low discoverability and hidden capability.
- Follow-up:
  - add an explicit checkout action affordance in refs rows (button/menu/shortcut hint)
  - keep double-click as optional power-user behavior

### P3: Reduce refresh cost on large repositories

- Problem: polling plus repeated total-count queries can be expensive on large histories.
- Risk: avoidable CPU and Git process overhead.
- Follow-up:
  - reduce background refresh frequency when app is idle
  - avoid full count recomputation on every background poll
  - consider count caching keyed by selected ref

## Validation checklist for follow-up PRs

- Runtime tests cover invalid hashes, merge commits, and empty-subject commits.
- Web UI displays explicit error states for diff fetch failures.
- Manual UX check confirms branch switching is discoverable without hidden gestures.
- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run web:typecheck`, and `npm run web:test` pass.
