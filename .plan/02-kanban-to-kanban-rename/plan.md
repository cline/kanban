# Kanban to Kanban Rename Plan

## Goal
Rename project identity from `Kanban` to `Kanban` across package metadata, CLI UX, runtime protocol surfaces, state paths, UI copy, tests, and release automation while minimizing upgrade breakage.

## Scope
1. In scope
   - npm package identity and CLI command naming
   - runtime env/header namespace changes
   - filesystem state path and migration handling
   - web UI copy and links
   - tests and fixtures
   - GitHub and npm metadata consistency
2. Out of scope for first pass
   - historical `.plan` archives unless we explicitly choose to rewrite history docs
   - non-functional refactors unrelated to rename

## Current Investigation Snapshot
1. Git remote already points to `git@github.com:cline/kanban.git`.
2. Search inventory found 53 rename-relevant files outside `.plan` and dependency/build directories.
3. Highest risk rename surfaces are:
   - package name and bin command in `package.json`
   - runtime headers/env vars (`x-kanban-workspace-id`, `KANBAN_*`)
   - persisted storage path `.kanban`
   - update logic defaults in `src/update/auto-update.ts`

## Rename Surface Map

### 1) Package and repository metadata
- `package.json`
- `package-lock.json`
- `web-ui/package.json`
- `web-ui/package-lock.json`
- `README.md`
- `CONTRIBUTING.md`
- `DEVELOPMENT.md`
- `.github/ISSUE_TEMPLATE/bug.yml`
- `.github/ISSUE_TEMPLATE/config.yml`

Required outcomes:
1. Package and repo links point to `cline/kanban`.
2. Publish metadata aligns with npm package identity.

### 2) CLI command and manpage identity
- `src/cli.ts`
- `src/core/kanban-command.ts`
- `src/commands/mcp.ts`
- `src/commands/hooks.ts`
- `src/terminal/activity-preview.ts`
- `man/kanban.1`
- `scripts/fix-node-pty-helper-perms.mjs`

Required outcomes:
1. Primary command is `kanban`.
2. Decide compatibility window for `kanban` alias.
3. Man page command name and file naming strategy are finalized.

### 3) Runtime protocol namespace
- `src/core/runtime-endpoint.ts`
- `src/server/runtime-server.ts`
- `src/trpc/app-router.ts`
- `src/mcp/server.ts`
- `src/terminal/ws-server.ts`
- `src/terminal/hook-runtime-context.ts`
- `src/terminal/agent-session-adapters.ts`
- `src/update/auto-update.ts`
- `web-ui/src/runtime/trpc-client.ts`

Required outcomes:
1. Runtime header/env names are migrated safely.
2. Mixed-version compatibility policy is explicit.

### 4) State and config paths
- `src/config/runtime-config.ts`
- `src/state/workspace-state.ts`
- `test/utilities/temp-dir.ts`
- `web-ui/src/components/runtime-settings-dialog.tsx`

Required outcomes:
1. New canonical path policy for config/state is defined.
2. Existing `~/.kanban` and `<repo>/.kanban` data remains readable during transition.

### 5) Web UI copy and navigation links
- `web-ui/index.html`
- `web-ui/src/App.tsx`
- `web-ui/src/components/project-navigation-panel.tsx`
- `web-ui/src/components/detail-panels/agent-terminal-panel.tsx`
- `web-ui/src/hooks/runtime-disconnected-fallback.tsx`
- `web-ui/src/hooks/use-review-ready-notifications.ts`
- `web-ui/src/utils/tab-visibility-presence.ts`
- `web-ui/src/storage/local-storage-store.ts`

Required outcomes:
1. User-facing branding is consistent.
2. Local storage keys have migration handling if renamed.

### 6) Tests and integration fixtures
- `test/runtime/kanban-command.test.ts`
- `test/runtime/config/runtime-config.test.ts`
- `test/runtime/update/auto-update.test.ts`
- `test/runtime/terminal/hook-runtime-context.test.ts`
- `test/runtime/terminal/agent-session-adapters.test.ts`
- `test/integration/runtime-state-stream.integration.test.ts`
- `test/integration/workspace-state.integration.test.ts`
- `test/runtime/mcp/server.integration.test.ts`
- `test/runtime/git-history.test.ts`
- `web-ui/src/hooks/use-workspace-sync.test.tsx`
- `web-ui/src/utils/tab-visibility-presence.test.ts`
- `web-ui/tests/smoke.spec.ts`

Required outcomes:
1. Rename changes are covered by updated assertions.
2. Compatibility behavior is explicitly tested where retained.

## Decision Gate Before Editing Core Runtime
1. Package and CLI policy
   - Option A: immediate hard switch to `kanban` only
   - Option B: dual command support (`kanban` primary, `kanban` alias) for one or more releases
2. State path migration policy
   - Option A: hard switch to `.kanban`
   - Option B: read old path and write new path with migration markers
   - Option C: continue using `.kanban` path temporarily while branding changes first
3. Protocol namespace policy
   - Option A: hard switch header/env names
   - Option B: accept old and new names during compatibility window

## Execution Phases

### Phase 0: Freeze decisions and acceptance criteria
Deliverables:
1. Final choices for CLI alias, state migration, protocol compatibility.
2. Release note strategy for breaking vs non-breaking changes.

Exit criteria:
1. Decision table in `status.md` marked resolved.

### Phase 1: Metadata and link alignment
Changes:
1. Update repo URLs and package metadata.
2. Update issue templates and top-level docs references.

Exit criteria:
1. No `cline/kanban` links remain outside intentionally preserved historical docs.

### Phase 2: CLI identity migration
Changes:
1. Rename bin command and help text to `kanban`.
2. Implement optional alias behavior based on Phase 0 decision.
3. Update man page path/content and package `man` field.

Exit criteria:
1. `npm pack` tarball contains expected executable and manpage.
2. Help output reflects final branding.

### Phase 3: Runtime namespace and state migration
Changes:
1. Header and env var migration.
2. `.kanban` to target path migration logic per decision.
3. Local storage key migration in web UI if keys change.

Exit criteria:
1. Existing user state survives upgrade in integration tests.
2. Runtime API works with expected compatibility matrix.

### Phase 4: Test hardening and release readiness
Changes:
1. Update and add tests for alias/migration behavior.
2. Verify CI and publish workflow behavior.

Exit criteria:
1. `npm run check` passes.
2. `npm run build` passes.
3. `npm publish --dry-run` output is correct.

### Phase 5: Optional cleanup release
Changes:
1. Remove legacy aliases after deprecation window, if selected.

Exit criteria:
1. Deprecation checklist completed.

## Risk Register and Mitigations
1. Breaking existing scripts that call `kanban`
   - Mitigation: keep temporary alias and test both names.
2. Losing existing runtime config/state
   - Mitigation: migration path and integration coverage.
3. Mixed-version client/server incompatibility due header rename
   - Mitigation: dual header support during transition.
4. Auto-update regressions after package rename
   - Mitigation: update package defaults and test update command generation.
5. Partial rename drift across docs/UI/tests
   - Mitigation: repeat inventory search at each phase gate.

## Validation Checklist Per Milestone
1. Inventory checks
   - `rg -n -i "kanban|cline/kanban" /Users/saoud/Repositories/kanban-idea/kanban`
   - `rg -n "x-kanban-workspace-id|KANBAN_|\.kanban" /Users/saoud/Repositories/kanban-idea/kanban`
2. Build and test
   - `npm run build`
   - `npm run check`
3. Packaging sanity
   - `npm pack --dry-run`
4. Manual smoke checks
   - `node dist/cli.js --help`
   - command invocation checks for chosen compatibility policy

## Rollback Strategy
1. Execute each phase in separate commits.
2. If a phase fails validation, revert that phase commit only.
3. Do not mix protocol/state migrations with unrelated changes.

## Progress Tracking Location
Use `status.md` in this folder as the source of truth for phase completion and decision state.
