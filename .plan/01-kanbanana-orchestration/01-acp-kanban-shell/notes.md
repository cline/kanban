# Phase 01 Notes

## Intent
This phase proves the central promise: Kanban UI can dispatch ACP-backed agent work.

## Decisions
1. One task card maps to one process and one provider.
2. Keep UI simple and stable before adding advanced orchestration.
3. Persistence comes early to avoid rework in later phases.
4. Use a dedicated ACP client interface in UI with a mock implementation first, so real ACP transport can be swapped in without UI churn.
5. Auto-move completed in-progress tasks to ready-for-review, while keeping ready-for-review to done as explicit manual user action.
6. Keep diff and file panels functional using ACP tool-call artifacts in this slice, then swap to runtime-backed git data later.

## Implemented This Session
1. Refactored board to target lifecycle columns: backlog, to-do, in-progress, ready-for-review, done.
2. Added local persistence for board state with migration from older column/card shapes.
3. Added task-scoped chat sessions with persistence and ACP turn lifecycle management.
4. Added ACP adapter abstraction and wired a functional mock ACP client for streaming plan/tool/chat updates.
5. Wired board lifecycle to start runs when cards enter in-progress and move to ready-for-review on run completion.
6. Implemented functional diff and file panels from task session artifacts.
7. Updated smoke tests and validated with Playwright.

## Risks
1. ACP behavior differences between providers may require adapter normalization.
2. Browser-only mock runtime cannot yet read real repo files or git diffs, so runtime API wiring is still required for production behavior.
