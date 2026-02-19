# Notes

## Source
- Primary ideation source: `.plan/docs/ideation-chat.md`

## Confirmed Priorities
1. Start with ACP-integrated Kanban webview.
2. Keep diff, worktrees, and keyboard as separate later phases.
3. Task context is its own phase.
4. Dependencies are their own phase.
5. Decompose is its own phase.
6. Keep usage/subscription management light for now.

## Product Constraints
1. Kanbanana is dispatch-and-review, not a replacement for terminal-native workflows.
2. One task card maps to one CLI process.
3. Ready-for-review does not auto-transition to done.
4. Worktree cleanup should follow explicit user move to done.
5. ACP command resolution should prioritize `KANBANANA_ACP_COMMAND` and fall back to global config in `~/.kanbanana/config.json`.

## Deferred by Design
1. Multi-agent race is intentionally not part of the early critical path.
2. Advanced provider strategy is postponed until core execution loop is stable.

## Vibe-Kanban Reference Alignment
1. Use the `ProjectKanban` and `Workspaces` split-pane model as functional inspiration: fixed page shell with per-pane scrolling (`min-h-0` and `overflow-hidden` on containers).
2. Keep detail view as a three-pane functional layout: conversation, inline diff sections, and file tree with change stats.
3. Keep runtime and UI decoupled through typed API contracts, with client-side graceful fallback when runtime APIs are unavailable.
4. Keep scope intentionally narrower than vibe-kanban for now: no cloud auth/accounts, no remote org/project sync, no advanced review comments system.
5. Keep phase ordering from PSN, but borrow implementation patterns from vibe-kanban where they directly improve local-first orchestration.
