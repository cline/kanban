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

## Deferred by Design
1. Multi-agent race is intentionally not part of the early critical path.
2. Advanced provider strategy is postponed until core execution loop is stable.

