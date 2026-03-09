# Rename Inventory

## Snapshot
1. Date: 2026-03-08
2. Search query: `kanban|cline/kanban` (case-insensitive)
3. Exclusions for primary inventory: `node_modules`, `dist`, `web-ui/dist`, `.git`, `.plan`
4. Primary rename set: 53 files
5. Historical `.plan` set: 21 files

## Primary Rename Set (53 files)

### Hidden/config
- `.codex/environments/environment.toml`
- `.github/ISSUE_TEMPLATE/bug.yml`
- `.github/ISSUE_TEMPLATE/config.yml`

### Root docs and metadata
- `AGENTS.md`
- `CONTRIBUTING.md`
- `DEVELOPMENT.md`
- `README.md`
- `package.json`
- `package-lock.json`

### Runtime and CLI code
- `src/cli.ts`
- `src/commands/hooks.ts`
- `src/commands/mcp.ts`
- `src/config/runtime-config.ts`
- `src/core/kanban-command.ts`
- `src/core/runtime-endpoint.ts`
- `src/mcp/server.ts`
- `src/server/runtime-server.ts`
- `src/state/workspace-state.ts`
- `src/terminal/activity-preview.ts`
- `src/terminal/agent-session-adapters.ts`
- `src/terminal/hook-runtime-context.ts`
- `src/terminal/ws-server.ts`
- `src/trpc/app-router.ts`
- `src/update/auto-update.ts`

### Scripts and man pages
- `man/kanban.1`
- `scripts/fix-node-pty-helper-perms.mjs`

### Tests
- `test/integration/runtime-state-stream.integration.test.ts`
- `test/integration/workspace-state.integration.test.ts`
- `test/runtime/config/runtime-config.test.ts`
- `test/runtime/git-history.test.ts`
- `test/runtime/kanban-command.test.ts`
- `test/runtime/mcp/server.integration.test.ts`
- `test/runtime/terminal/agent-session-adapters.test.ts`
- `test/runtime/terminal/hook-runtime-context.test.ts`
- `test/runtime/update/auto-update.test.ts`
- `test/utilities/temp-dir.test.ts`
- `test/utilities/temp-dir.ts`

### Web UI
- `web-ui/README.md`
- `web-ui/index.html`
- `web-ui/package.json`
- `web-ui/package-lock.json`
- `web-ui/src/App.tsx`
- `web-ui/src/components/detail-panels/agent-terminal-panel.tsx`
- `web-ui/src/components/project-navigation-panel.tsx`
- `web-ui/src/components/runtime-settings-dialog.tsx`
- `web-ui/src/hooks/runtime-disconnected-fallback.tsx`
- `web-ui/src/hooks/use-review-ready-notifications.ts`
- `web-ui/src/hooks/use-workspace-sync.test.tsx`
- `web-ui/src/runtime/trpc-client.ts`
- `web-ui/src/storage/local-storage-store.ts`
- `web-ui/src/utils/tab-visibility-presence.test.ts`
- `web-ui/src/utils/tab-visibility-presence.ts`
- `web-ui/tests/smoke.spec.ts`

## Historical `.plan` References (21 files)
- `.plan/01-kanban-orchestration/01-acp-kanban-shell/notes.md`
- `.plan/01-kanban-orchestration/01-acp-kanban-shell/plan.md`
- `.plan/01-kanban-orchestration/01-acp-kanban-shell/status.md`
- `.plan/01-kanban-orchestration/04-diff-review-workflow/plan.md`
- `.plan/01-kanban-orchestration/05-commit-pr-operations/plan.md`
- `.plan/01-kanban-orchestration/10-shared-project-config-shortcuts/notes.md`
- `.plan/01-kanban-orchestration/10-shared-project-config-shortcuts/plan.md`
- `.plan/01-kanban-orchestration/10-shared-project-config-shortcuts/status.md`
- `.plan/01-kanban-orchestration/11-polish-packaging/plan.md`
- `.plan/01-kanban-orchestration/notes.md`
- `.plan/01-kanban-orchestration/plan.md`
- `.plan/01-kanban-orchestration/status.md`
- `.plan/02-kanban-to-kanban-rename/plan.md`
- `.plan/02-kanban-to-kanban-rename/status.md`
- `.plan/docs/hooks-update/codex-hooks-research.md`
- `.plan/docs/hooks-update/hooks-implementation-plan.md`
- `.plan/docs/hooks-update/hooks-update-research.md`
- `.plan/docs/ideation-chat.md`
- `.plan/docs/kick-off-prompt.md`
- `.plan/docs/planning-column-research.md`
- `.plan/docs/runtime-hooks-architecture.md`

## Commands to Refresh This Inventory
```bash
rg -l -i "kanban|cline/kanban" \
  /Users/saoud/Repositories/kanban-idea/kanban \
  --hidden \
  --glob '!node_modules/**' \
  --glob '!dist/**' \
  --glob '!web-ui/dist/**' \
  --glob '!.git/**' \
  --glob '!.plan/**'

rg -l -i "kanban|cline/kanban" \
  /Users/saoud/Repositories/kanban-idea/kanban/.plan \
  --hidden
```
