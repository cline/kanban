# Rename Status Tracker

## Current State
1. Initiative: `02-kanban-to-kanban-rename`
2. Overall progress: planning
3. Last updated: 2026-03-08

## Decision Tracker
1. Package naming target (`kanban` on npm)
   - Status: pending confirmation
   - Notes: remote already moved to `cline/kanban`
2. CLI compatibility window (`kanban` alias)
   - Status: pending
3. Runtime namespace migration (`KANBAN_*`, `x-kanban-workspace-id`)
   - Status: pending
4. State path migration (`.kanban` to target path)
   - Status: pending

## Phase Checklist

### Phase 0: Decision freeze
- [x] Repo-wide investigation completed
- [ ] Decision table finalized
- [ ] Acceptance criteria finalized

### Phase 1: Metadata and links
- [ ] Update package and repository URLs
- [ ] Update web UI GitHub links
- [ ] Update issue template references
- [ ] Re-run inventory search for stale links

### Phase 2: CLI identity
- [ ] Rename package/bin/man identity in `package.json`
- [ ] Update CLI help and command parsing
- [ ] Implement alias policy if selected
- [ ] Update command docs and examples

### Phase 3: Runtime and state migration
- [ ] Migrate header/env namespace per policy
- [ ] Migrate filesystem state path per policy
- [ ] Migrate web local storage keys if needed
- [ ] Add compatibility tests

### Phase 4: Validation and release prep
- [ ] `npm run build`
- [ ] `npm run check`
- [ ] `npm pack --dry-run`
- [ ] Manual CLI smoke checks

### Phase 5: Post-migration cleanup (optional)
- [ ] Remove deprecated aliases
- [ ] Remove compatibility shims
- [ ] Final rename inventory sweep

## Investigation Summary
1. 53 files outside `.plan` currently contain rename-relevant `kanban` references.
2. Top impact areas:
   - package/bin/man identity
   - runtime namespace
   - persisted state path
   - update and publish behavior

## Open Risks
1. Hard switch can break existing scripts and automations.
2. State path migration can break existing users if not handled compatibly.
3. Mixed-version runtime/web clients can fail if protocol rename is not compatibility-aware.

## Resume Point
Start with Phase 0 decisions, then execute Phase 1 in a dedicated commit.
