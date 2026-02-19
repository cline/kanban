# Kanbanana PSN Master Plan

## Vision
Kanbanana is a local-first orchestration layer for CLI agents.
It should let users dispatch many tasks, monitor progress, and review outcomes from one Kanban interface.

## Architecture Baseline
1. User entrypoint is `npx kanbanana`.
2. CLI starts one local runtime process that:
   - serves the web app in browser
   - exposes local API and event stream
   - runs ACP orchestration and task lifecycle
3. Scope resolution:
   - board and runtime APIs operate on the current working repo/workspace
   - runtime config/state storage is global at `~/.kanbanana`
4. Storage model:
   - `~/.kanbanana` for runtime config/state/logs
   - repo data remains in repo files, git metadata, and worktrees when enabled
5. Repo structure direction:
   - `web-ui` for webview UI
   - `packages/cli` for command entrypoint and server bootstrap
   - `packages/core` for orchestration domain logic
   - `packages/acp` for ACP adapters/session lifecycle
   - `packages/store` for persistence and migrations
   - `packages/protocol` for shared typed API/event contracts
6. Delivery rule:
   - each phase must produce a runnable, testable vertical slice on this architecture

## Phase Strategy
1. Ship vertical slices that are runnable and testable.
2. Keep complex features isolated by phase so validation is clear.
3. Defer optional or flashy capabilities until the core loop is stable.

## Ordered Phases
1. `01-acp-kanban-shell`
   - Build Kanban webview plus ACP-connected task execution loop.
2. `02-runtime-reliability`
   - Harden process lifecycle, alerts, and stuck-task recovery.
3. `03-worktree-abstraction`
   - Add isolated worktree execution and cleanup management.
4. `04-diff-review-workflow`
   - Add first-class ready-for-review diff and feedback cycle.
5. `05-commit-pr-operations`
   - Add commit and PR flows with detached HEAD aware behavior.
6. `06-task-context-system`
   - Add context attachments and tasks-as-context.
7. `07-dependency-graph`
   - Add task dependencies and auto-start unblocked tasks.
8. `08-decompose-workflow`
   - Add decomposition into subtasks plus dependency generation.
9. `09-keyboard-speed-ux`
   - Add keyboard-first navigation and command palette flow.
10. `10-shared-project-config-shortcuts`
   - Add global runtime config shortcuts and script shortcut buttons.
11. `11-polish-packaging`
   - Add onboarding polish, packaging hardening, and minimal usage/subscription page.

## Deferred Track
1. Multi-agent race mode for same task.
2. Advanced provider-switch automation beyond basic selection.
3. Deep usage analytics beyond lightweight links and placeholders.
