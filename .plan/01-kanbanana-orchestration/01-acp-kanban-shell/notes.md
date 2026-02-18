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
8. Added CLI runtime boot path that serves packaged `web-ui` assets locally and launches browser by default.
9. Updated root build pipeline to package `web-ui` assets into `dist/web-ui` for CLI runtime serving.
10. Added runtime ACP API endpoints (`/api/acp/health`, `/api/acp/turn`) with request validation and error handling.
11. Added ACP SDK subprocess turn runner on Node side, including initialize/session/prompt flow and session update capture.
12. Added browser ACP client that calls runtime ACP API and falls back to local mock behavior when ACP is unavailable.
13. Reworked runtime ACP from one-turn subprocesses to persistent task-scoped ACP sessions with session reuse across prompts.
14. Added runtime ACP cancellation endpoint (`/api/acp/cancel`) and wired browser client cancel to session-level `session/cancel`.
15. Added runtime workspace changes endpoint (`/api/workspace/changes`) backed by local git diff/status and file snapshots.
16. Wired detail diff/file panels to runtime workspace data with fallback to ACP artifact-derived data.
17. Added runtime ACP health signal in top bar ("Mock ACP mode") with lightweight installed-command detection.
18. Cross-checked layout and panel behavior against `vibe-kanban` references to keep split-pane and scroll behavior function-first.
19. Added project-level ACP runtime config (`.kanbanana/config.json`) with server API (`/api/runtime/config`) and precedence handling (`KANBANANA_ACP_COMMAND` overrides project config).
20. Added in-app runtime settings dialog (top-right settings) to configure ACP command without shell env edits.

## Risks
1. ACP behavior differences between providers may require adapter normalization.
2. Runtime ACP command suggestions (`codex --acp`, `claude --acp`, `gemini --acp`) are heuristics and may differ by installed agent version.
3. Workspace changes are currently derived from the active repo root and not yet from per-task worktrees.
