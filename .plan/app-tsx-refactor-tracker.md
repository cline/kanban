# App.tsx Refactor Tracker

## Purpose
- Keep a durable, detailed source of truth for the `web-ui/src/App.tsx` refactor.
- Preserve context across compactions so no important detail is lost.
- Track progress with explicit checklist items that get checked off as work completes.

## Scope
- In scope: `web-ui/src/App.tsx` and new files created to extract logic from it.
- In scope: architecture cleanup in `web-ui/src/kanban/**` that supports App decomposition.
- Out of scope for this plan: `src/cli.ts` and runtime backend refactors.

## Baseline Snapshot
- Current `App.tsx` size: 2902 lines
- Hook density in `App.tsx`: 60 `useCallback`, 24 `useEffect`, 24 `useMemo`, 22 `useState`
- File history count for `App.tsx`: 85 commits touching the file
- High churn domains from history: board/task flow, git actions, terminal/session controls, workspace/project switching

## Refactor Goals
1. Reduce `App.tsx` to a composition shell focused on layout and wiring.
2. Move orchestration logic into focused hooks with narrow interfaces.
3. Remove duplicated logic and centralize shared helpers.
4. Preserve behavior fully while making the code easier to test and evolve.
5. Keep changes incremental and shippable in small PR-sized slices.

## Non-goals
- No user-facing redesign.
- No protocol or backend behavior changes.
- No broad rewrite of existing stable feature modules unless needed for extraction boundaries.

## Target Shape

### Desired end-state metrics
- `App.tsx` target size: 400 to 700 lines.
- `App.tsx` should mainly contain:
  - top-level state that truly spans multiple domains
  - hook composition and prop mapping
  - top-level layout render tree
- Non-layout event orchestration should live in extracted hooks.

### App shell responsibilities
- Render top-level layout and route between home and detail surfaces.
- Compose domain hooks and wire their contracts together.
- Build final component props for:
  - `TopBar`
  - `ProjectNavigationPanel`
  - `KanbanBoard`
  - `CardDetailView`
  - dialogs and alerts
- Keep only minimal cross-domain glue state that cannot reasonably belong to one domain.

### App shell should not own
- Direct tRPC mutation/query orchestration for specific feature domains.
- Domain-specific side-effect coordination (git, terminal, project navigation, task session lifecycle).
- Duplicate utility logic that already exists in other hooks.

### Proposed module layout
```txt
web-ui/src/kanban/app/
  app-shell.tsx                     // optional wrapper if App.tsx still large
  app-domain-types.ts               // shared contracts between extracted hooks
  use-workspace-sync.ts
  use-project-navigation.ts
  use-task-editor.ts
  use-task-sessions.ts
  use-git-actions.ts
  use-terminal-panels.ts
  use-board-interactions.ts
```

### Hook boundary details

#### `useWorkspaceSync`
- Owns
  - applying streamed workspace snapshots
  - workspace revision tracking and stale update protection
  - persistence conflict handling glue with `useWorkspacePersistence`
  - workspace refresh orchestration on visibility changes
- Inputs
  - `currentProjectId`, streamed workspace payload, visibility status
- Outputs
  - canonical workspace state fields for app composition (`board`, `sessions`, `workspacePath`, `workspaceGit`, `workspaceRevision`, errors)
  - refresh actions and state (`refreshWorkspaceState`, `isWorkspaceStateRefreshing`)

#### `useProjectNavigation`
- Owns
  - selected/requested project resolution
  - URL pathname sync and popstate handling
  - add/remove/select project orchestration
  - pending project add resolution and fallback when project disappears
- Inputs
  - `projects`, `currentProjectId`, workspace metadata loading signals
- Outputs
  - navigation state (`requestedProjectId`, `navigationCurrentProjectId`, loading booleans)
  - handlers (`handleSelectProject`, `handleAddProject`, `handleRemoveProject`, `handleBack`)

#### `useTaskEditor`
- Owns
  - inline create/edit card state
  - create and edit validation rules
  - default branch selection policy for create/edit
  - reset behavior when selection/project context changes
- Inputs
  - board selection context, branch options, project-level defaults
- Outputs
  - create and edit state slices
  - create/edit handlers
  - `inlineTaskCreator` and `inlineTaskEditor` props payload helpers

#### `useTaskSessions`
- Owns
  - worktree ensure/delete and task workspace context fetch
  - start/stop task session and send input APIs
  - session upsert behavior
- Inputs
  - `currentProjectId`
- Outputs
  - session action methods (`ensureTaskWorkspace`, `startTaskSession`, `stopTaskSession`, `sendTaskSessionInput`, `cleanupTaskWorkspace`)
  - workspace info fetch helpers (`fetchTaskWorkspaceInfo`, `fetchTaskWorkingChangeCount`, `fetchReviewWorkspaceSnapshot`)

#### `useGitActions`
- Owns
  - git summary refresh and polling conditions
  - top-level git actions (`fetch`, `pull`, `push`, branch switch, discard)
  - task-level commit/PR dispatch flow and loading state maps
  - git action error modal state
- Inputs
  - project context, selected card context, runtime config, session input callback
- Outputs
  - git state and handlers used by top bar and cards

#### `useTerminalPanels`
- Owns
  - home terminal and detail terminal open/start/expand/close lifecycle
  - terminal selection refs and startup sequencing
  - hotkey-facing toggle callbacks and command send handlers
- Inputs
  - project context, selected card context, session start callbacks, `sendTaskSessionInput`
- Outputs
  - terminal UI state for both panes
  - toggle/expand/send handlers
  - refs used by hotkeys

#### `useBoardInteractions`
- Owns
  - drag end behavior and programmatic move reconciliation
  - start-task from backlog orchestration
  - move-to-trash and clear-trash orchestration
  - review comment send/add and auto-review cancellation
- Inputs
  - board, sessions, dependencies on task session and workspace hooks
- Outputs
  - board action handlers passed to board/detail components

### Shared utility cleanup
- Create a single helper module for detail-view task sequencing utilities currently duplicated in:
  - `web-ui/src/App.tsx`
  - `web-ui/src/kanban/hooks/use-linked-backlog-task-actions.ts`
- Candidate module path:
  - `web-ui/src/kanban/utils/detail-view-task-order.ts`
- Candidate exports:
  - `isDetailViewColumnId(columnId)`
  - `getNextDetailTaskIdAfterTrashMove(board, taskId)`

### State ownership guide
- `App.tsx`
  - only cross-domain glue state
- Domain hooks
  - own domain state and transitions
- Presentational components
  - avoid new side-effect orchestration; consume handlers and render

### Side-effect policy
- Keep network and runtime side effects inside domain hooks.
- Keep side-effect ordering unchanged while extracting.
- Prefer explicit action methods over exposing raw setters across domains.

### Contract style for extracted hooks
- Each hook should export:
  - a typed input object
  - a typed output object
  - no hidden reliance on global mutable state
- Keep callback names aligned with current handler naming to minimize migration risk.
- Hook naming convention: do not prefix with `app`; prefer domain-first names like `useTaskSessions`, `useGitActions`, `useTerminalPanels`.

### Migration sequencing rules
- Extract one domain hook per phase.
- Preserve behavior first, simplify second.
- After each extraction phase:
  - run validators
  - run smoke checks for affected domain
  - update this tracker before continuing

### Testing shape after decomposition
- Add focused unit tests for pure helper modules extracted from App logic.
- Prefer domain-hook tests for branching behavior that currently sits in App callbacks.
- Keep integration confidence via existing app-level tests and smoke checklist.

## Constraints and Safety Rules
- Preserve all existing runtime behavior.
- Do not introduce `any` types.
- Follow existing Blueprint and project conventions.
- Prefer extracting code as-is first, then simplify after parity.
- Validate each phase before moving to the next phase.

## Master Todo List

### Extraction order and acceptance checks
1. Phase 1: shared helper deduplication
   - Acceptance checks
     - One shared implementation exists for detail-view next-task selection.
     - `App.tsx` and `use-linked-backlog-task-actions.ts` both import shared utility.
     - Focused utility tests pass.
2. Phase 2: session and workspace API extraction
   - Acceptance checks
     - All session/worktree API calls are moved from App to `useTaskSessions`.
     - No regressions in task start, stop, send input, and trash cleanup flows.
3. Phase 3: git extraction
   - Acceptance checks
     - App no longer owns git polling and action orchestration details.
     - Top bar git actions and review commit/PR task actions preserve behavior.
4. Phase 4: terminal extraction
   - Acceptance checks
     - Home and detail terminal lifecycle logic moves to `useTerminalPanels`.
     - Hotkeys still target correct terminal surface based on selection context.
5. Phase 5: project navigation extraction
   - Acceptance checks
     - URL sync, popstate, add/remove/select, and fallback flows move to `useProjectNavigation`.
     - Project switch loading behavior parity is maintained.
6. Phase 6: task editor and board interactions extraction
   - Acceptance checks
     - Create/edit state is owned by `useTaskEditor`.
     - Drag/start/trash/review-comment orchestration is owned by `useBoardInteractions`.
7. Phase 7: App shell slimming
   - Acceptance checks
     - App acts primarily as composition and layout shell.
     - No dead callbacks/state remain from pre-extraction implementation.

### Phase 0: setup and guardrails
- [x] Create this tracker file
- [x] Capture current `App.tsx` behavior map and dependency map in this file
- [x] Define extraction order and exact acceptance checks for each phase

### Phase 1: shared helper deduplication
- [x] Extract shared detail-view helper utilities used by App and backlog task actions
- [x] Replace duplicated local implementations with shared utility imports
- [x] Add or update focused tests for helper behavior

### Phase 2: task session and workspace API extraction
- [x] Extract session/worktree API calls from App into `useTaskSessions`
- [x] Keep existing state transitions and error handling behavior identical
- [x] Update App to consume the new hook contract
- [x] Run validators and verify no behavior drift

### Phase 3: git action extraction
- [x] Extract git summary polling and git action handlers into `useGitActions`
- [x] Extract task commit/PR dispatch flow into the same domain hook
- [x] Keep task loading maps and toast behavior unchanged
- [x] Update App to consume the new hook contract

### Phase 4: terminal panel lifecycle extraction
- [x] Extract home terminal state and lifecycle handlers into `useTerminalPanels`
- [x] Extract detail terminal state and lifecycle handlers into `useTerminalPanels`
- [x] Keep hotkey behavior and connection-ready behavior unchanged
- [x] Update App wiring to new hook output

### Phase 5: project navigation and URL sync extraction
- [x] Extract project selection, URL sync, and popstate flows into `useProjectNavigation`
- [x] Extract add/remove project orchestration into the navigation domain
- [x] Ensure loading-state behavior parity during project switches

### Phase 6: task editor and board interaction extraction
- [x] Extract create/edit form state and handlers into `useTaskEditor`
- [x] Extract drag/start/trash/review-comment orchestration into `useBoardInteractions`
- [x] Keep programmatic card move integration behavior unchanged

### Phase 7: App shell slimming and cleanup
- [ ] Reduce App to orchestration composition and layout rendering
- [x] Remove dead state and dead callbacks after extraction
- [x] Re-run full validation suite
- [x] Document final architecture summary in this tracker

## Validation Checklist Per Phase
- [x] Lint passes
- [x] Typecheck passes
- [x] Tests pass
- [ ] Manual smoke check of core flows completed

## Behavior Parity Smoke Checklist
- [ ] Project add/remove/switch still works and URL stays in sync
- [ ] Backlog create/edit/start task flows still work
- [ ] Drag between columns still works including programmatic moves
- [ ] Trash warning and clear trash flows still work
- [ ] Home and detail terminal open/toggle/expand flows still work
- [ ] Git history view and git actions still work
- [ ] Task commit/PR action dispatch still works
- [ ] Runtime disconnect and error banners still behave correctly

## Session Work Log

### 2026-03-07 Session 1
- Completed
  - Architecture audit of `App.tsx`
  - Git-history-guided seam identification
  - Initial extraction plan and phase breakdown
  - Tracker file scaffold
- Next
  - Fill behavior map and dependency map
  - Start Phase 1 helper deduplication
- Risks noted
  - Hidden coupling between drag/trash/session side effects
  - Terminal lifecycle state and refs are easy to regress during extraction

### 2026-03-07 Session 2
- Completed
  - Filled extraction order and phase acceptance checks
  - Completed Phase 0 mapping work in tracker
  - Completed Phase 1 helper deduplication implementation
  - Added focused tests for shared detail-view task-order utility
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Next
  - Start Phase 2 by extracting task session and workspace API methods into `useTaskSessions`
- Risks noted
  - Phase 2 has high callback dependency density in App and should be extracted in one bounded slice

### 2026-03-07 Session 3
- Completed
  - Added shared utility module `web-ui/src/kanban/utils/detail-view-task-order.ts`
  - Replaced duplicated detail-task-order helpers in App and linked-backlog task actions hook
  - Added focused tests for detail-task-order behavior
  - Extracted task session/workspace API orchestration into `useTaskSessions`
  - Updated `App.tsx` to consume `useTaskSessions` hook contract
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Next
  - Start Phase 3 git action extraction into `useGitActions`
- Risks noted
  - Git extraction touches many callbacks and state slices and should be staged carefully

### 2026-03-07 Session 4
- Completed
  - Renamed extracted hook from `useAppTaskSessions` to `useTaskSessions`
  - Renamed file from `use-app-task-sessions.ts` to `use-task-sessions.ts`
  - Updated App import and hook usage to match naming convention
  - Updated tracker naming convention and planned hook names to remove `app` prefixes
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Next
  - Start Phase 3 git extraction into `useGitActions`

### 2026-03-07 Session 5
- Completed
  - Added `web-ui/src/kanban/app/use-git-actions.ts` to own git summary polling, git actions, and task commit/PR dispatch orchestration
  - Moved `useGitHistoryData` composition into `useGitActions` so git-history refresh wiring is encapsulated with git state
  - Updated `App.tsx` to consume `useGitActions` outputs and removed in-file git orchestration callbacks/state
  - Preserved existing UI wiring for top bar git actions, review commit/PR actions, loading maps, and git action error alert
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Next
  - Start Phase 4 terminal lifecycle extraction into `useTerminalPanels`
- Risks noted
  - Terminal extraction has ref-heavy sequencing and hotkey coupling that should be migrated in one bounded pass

### 2026-03-07 Session 6
- Completed
  - Added `web-ui/src/kanban/app/use-terminal-panels.ts` for home/detail terminal panel state, lifecycle handlers, and session-start orchestration
  - Moved terminal startup/toggle/expand/close sequencing out of `App.tsx`
  - Added `prepareTerminalForShortcut` helper in terminal hook and updated shortcut execution flow in `App.tsx` to use it
  - Updated `App.tsx` render wiring to use terminal hook outputs (`closeHomeTerminal`, `closeDetailTerminal`, pane sizing and expand handlers)
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Next
  - Start Phase 5 project navigation extraction into `useProjectNavigation`
- Risks noted
  - Project navigation extraction touches URL effects and project add/remove flows that currently reset multiple app state slices

### 2026-03-07 Session 7
- Completed
  - Added `web-ui/src/kanban/app/use-project-navigation.ts` to own requested project state, URL synchronization, popstate handling, and project add/remove/select orchestration
  - Moved runtime stream composition (`useRuntimeStateStream`) into `useProjectNavigation` to eliminate requested-project state circularity in App
  - Updated `App.tsx` to consume `useProjectNavigation` outputs and removed in-file project navigation effects/handlers
  - Kept project-switch reset behavior parity by wiring `onProjectSwitchStart` and `resetProjectNavigationState`
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Next
  - Start Phase 6 task editor and board interaction extraction into `useTaskEditor` and `useBoardInteractions`
- Risks noted
  - Phase 6 will touch high-churn drag/trash/start flows and should be split carefully to preserve transition ordering

### 2026-03-07 Session 8
- Completed
  - Added `web-ui/src/kanban/app/use-task-editor.ts` to own create/edit form state, branch resolution, and create/edit handlers
  - Updated `App.tsx` to consume `useTaskEditor` outputs and removed in-file editor effects/handlers
  - Wired project-switch behavior to reset task editor state while preserving existing switch UX
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Next
  - Continue Phase 6 by extracting drag/start/trash/review-comment orchestration into `useBoardInteractions`

### 2026-03-07 Session 9
- Completed
  - Added `web-ui/src/kanban/app/use-board-interactions.ts` to own drag/start/trash/review-comment orchestration and programmatic card move wiring
  - Moved `useProgrammaticCardMoves`, `useLinkedBacklogTaskActions`, and `useReviewAutoActions` composition from `App.tsx` into `useBoardInteractions`
  - Updated `App.tsx` to consume `useBoardInteractions` outputs and replaced direct programmatic reset wiring with hook-owned project-reset behavior
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Metrics
  - `web-ui/src/App.tsx` line count: 1433 (from 1737 before Session 9)
- Next
  - Start Phase 7 shell slimming and dead-state/callback cleanup

### 2026-03-07 Session 10
- Completed
  - Added `web-ui/src/kanban/app/use-shortcut-actions.ts` to own shortcut preference persistence and shortcut command execution orchestration
  - Updated `App.tsx` to consume `useShortcutActions` outputs and removed inline shortcut handlers/state
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Metrics
  - `web-ui/src/App.tsx` line count: 1358 (from 1433 before Session 10)
- Next
  - Continue Phase 7 shell slimming and remove remaining App-only orchestration where practical

### 2026-03-07 Session 11
- Completed
  - Moved task kickoff and notification-permission orchestration from `App.tsx` into `useBoardInteractions`
  - Updated `useBoardInteractions` inputs to consume task-session APIs (`ensureTaskWorkspace`, `startTaskSession`) and own kickoff error/revert behavior
  - Removed App-local kickoff and notification callbacks plus related permission refs/imports
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Metrics
  - `web-ui/src/App.tsx` line count: 1265 (from 1358 before Session 11)
- Next
  - Continue Phase 7 shell slimming and remove remaining workspace hydration/orchestration blocks from App

### 2026-03-07 Session 12
- Completed
  - Added `web-ui/src/kanban/app/use-workspace-sync.ts` to own workspace snapshot apply/refresh orchestration, stale-revision protection, and workspace metadata pending signals
  - Updated `App.tsx` to consume `useWorkspaceSync` outputs (`workspacePath`, `workspaceGit`, `workspaceRevision`, `workspaceHydrationNonce`, `refreshWorkspaceState`)
  - Removed App-local workspace sync refs/effects/callbacks (`applyWorkspaceState`, refresh callback, stream-apply and visibility-refresh effects)
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Metrics
  - `web-ui/src/App.tsx` line count: 1158 (from 1265 before Session 12)
- Next
  - Continue Phase 7 by extracting remaining App shell glue (`selected task workspace info` fetch orchestration and top-bar/view-model derivations)

### 2026-03-07 Session 13
- Completed
  - Added `web-ui/src/kanban/app/use-selected-task-workspace-info.ts` to own selected-task workspace info state, staleness reset, and fetch effect orchestration
  - Updated `App.tsx` to consume `useSelectedTaskWorkspaceInfo` outputs and removed in-file selected-task workspace info memo/effect logic
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Metrics
  - `web-ui/src/App.tsx` line count: 1117 (from 1158 before Session 13)
- Next
  - Continue Phase 7 by extracting top-bar/view-model derivations and other remaining App shell glue

### 2026-03-07 Session 14
- Completed
  - Added `web-ui/src/kanban/app/use-shell-view-model.ts` to own detail-shell/top-bar/trash-guidance derivations and related shell view-model state
  - Added `web-ui/src/kanban/app/use-task-inline-cards.tsx` to own inline create/edit card JSX composition for App
  - Updated `App.tsx` to consume both hooks and removed in-file derivation/inline-card composition blocks
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Metrics
  - `web-ui/src/App.tsx` line count: 1058 (from 1117 before Session 14)
- Next
  - Continue Phase 7 by extracting remaining render-surface composition (home/detail sections) to reach shell-size target

### 2026-03-07 Session 15
- Completed
  - Added `web-ui/src/kanban/app/use-shell-hotkeys.ts` to own global app hotkey registrations (`mod+j`, `mod+m`, `c`)
  - Updated `App.tsx` to consume `useShellHotkeys` and removed inline `useHotkeys` registration blocks
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Metrics
  - `web-ui/src/App.tsx` line count: 1015 (from 1058 before Session 15)
- Next
  - Continue Phase 7 by extracting remaining render-surface composition (home/detail view sections)

### 2026-03-08 Session 16
- Completed
  - Added `web-ui/src/kanban/app/workspace-surfaces.tsx` to own home/detail render-surface composition previously in `App.tsx`
  - Added `web-ui/src/kanban/app/use-top-bar-props.ts` to own top-bar prop mapping and git/terminal/git-history action wiring
  - Added `web-ui/src/kanban/app/shell-dialogs.tsx` to own keyboard/settings/trash-warning/git-error dialog composition
  - Updated `App.tsx` to consume these new shell modules and removed large in-file render blocks
  - Kept hook contract style using explicit `Use...Input/Result` interfaces after in-session style alignment
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Metrics
  - `web-ui/src/App.tsx` line count: 813 (from 1015 before Session 16)
- Next
  - Continue Phase 7 by extracting remaining shell wiring and final dead-state cleanup to reach target size

### 2026-03-08 Session 17
- Completed
  - Added `web-ui/src/kanban/app/use-project-shell-state.ts` to own shell-only project overlays and loading/path derivations
  - Added `web-ui/src/kanban/app/use-task-branch-options.ts` to own task-branch option/default derivation logic
  - Added `web-ui/src/kanban/app/runtime-disconnected-fallback.tsx` for disconnected runtime surface rendering
  - Added `web-ui/src/kanban/app/shell-project-sidebar.tsx` for sidebar composition and project action wiring
  - Added `web-ui/src/kanban/app/use-shell-lifecycle.ts` for shell lifecycle effects and settings/back handlers
  - Updated `App.tsx` to consume extracted shell modules and keep only top-level composition wiring
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Metrics
  - `web-ui/src/App.tsx` line count: 698 (from 813 before Session 17)
- Architecture summary
  - `App.tsx` now composes focused domain and shell hooks/components (`useProjectNavigation`, `useWorkspaceSync`, `useTaskEditor`, `useBoardInteractions`, `useTopBarProps`, `WorkspaceSurfaces`, `ShellDialogs`) with minimal local glue state.
  - Render surfaces, dialog tree, top-bar props, sidebar composition, runtime-disconnected fallback, and lifecycle side-effects now live outside `App.tsx`.
  - `App.tsx` is now inside the target shell range and acts as a composition boundary rather than a feature-orchestration godfile.
- Next
  - Run manual behavior parity smoke checklist to close out Phase 7 completely.

### 2026-03-08 Session 18
- Completed
  - Per user direction, inlined `ShellProjectSidebar` back into `App.tsx` and rendered `ProjectNavigationPanel` directly in App
  - Per user direction, inlined `useTopBarProps` usage back into direct `TopBar` props in App
  - Per user direction, inlined `WorkspaceSurfaces` render composition back into App (home board, detail view, git history, terminal panes)
  - Per user direction, inlined `ShellDialogs` JSX back into App
  - Removed now-unused abstraction files:
    - `web-ui/src/kanban/app/shell-project-sidebar.tsx`
    - `web-ui/src/kanban/app/use-top-bar-props.ts`
    - `web-ui/src/kanban/app/workspace-surfaces.tsx`
    - `web-ui/src/kanban/app/shell-dialogs.tsx`
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Metrics
  - `web-ui/src/App.tsx` line count: 910 (from 698 before Session 18)
- Notes
  - This intentionally trades file-size target for lower abstraction depth based on user preference.

### 2026-03-08 Session 19
- Completed
  - Renamed shell-prefixed hooks to clearer app-layer names:
    - `use-shell-hotkeys.ts` -> `use-app-hotkeys.ts`
    - `use-shell-view-model.ts` -> `use-app-view-model.ts`
    - `use-project-shell-state.ts` -> `use-project-ui-state.ts`
  - Removed `use-shell-lifecycle.ts` and inlined its lifecycle effects and handlers directly in `App.tsx`
  - Updated App naming from `detailShell*` to `detailTerminal*` for terminal-specific clarity
  - Deleted obsolete shell-prefixed files after migration
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Metrics
  - `web-ui/src/App.tsx` line count: 959 (from 910 before Session 19)
- Notes
  - This aligns naming and abstraction depth with the architecture opinion to avoid vague, thin wrapper layers.

### 2026-03-08 Session 20
- Completed
  - Restored conservative stream-error recovery semantics in `App.tsx` so clearing stream errors does not wipe unrelated `worktreeError` values
  - Removed dead `useAppViewModel` API outputs (`runtimeHint`, `activeWorkspaceHint`) and kept them internal to derive navbar hints
  - Inlined `useTaskInlineCards` JSX in `App.tsx` and deleted `web-ui/src/kanban/app/use-task-inline-cards.tsx` as a thin wrapper
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Metrics
  - `web-ui/src/App.tsx` line count: 973 (from 959 before Session 20)
- Notes
  - This addresses review feedback on subtle error-handling behavior and removes a wrapper that conflicted with the architecture opinion on avoiding low-value indirection.

### 2026-03-08 Session 21
- Completed
  - Inlined `use-app-view-model` derivations back into `App.tsx` to keep derivations physically close to `TopBar` and `CardDetailView` consumers
  - Extracted trash warning copy to a tiny pure helper: `web-ui/src/kanban/utils/trash-warning-guidance.ts`
  - Removed obsolete `web-ui/src/kanban/app/use-app-view-model.ts`
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Metrics
  - `web-ui/src/App.tsx` line count: 1013 (from 973 before Session 21)
- Notes
  - This intentionally prioritizes navigability and lower indirection over App.tsx size reduction.

### 2026-03-08 Session 22
- Completed
  - Inlined `getTrashWarningGuidance` back into `App.tsx` as a local pure helper because it is single-use and part of local dialog presentation flow
  - Removed now-unused `web-ui/src/kanban/utils/trash-warning-guidance.ts`
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Metrics
  - `web-ui/src/App.tsx` line count: 1032 (from 1013 before Session 22)
- Notes
  - This follows the architecture preference to avoid single-use utility indirection.

### 2026-03-08 Session 23
- Completed
  - Moved `web-ui/src/kanban/hooks/use-linked-backlog-task-actions.ts` to `web-ui/src/kanban/app/use-linked-backlog-task-actions.ts`
  - Moved `web-ui/src/kanban/hooks/react-use.ts` to `web-ui/src/kanban/utils/react-use.ts`
  - Updated all imports to new paths and removed now-empty `web-ui/src/kanban/hooks/` directory
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Metrics
  - `web-ui/src/App.tsx` line count: 1032 (unchanged)
- Notes
  - This removes the confusing `hooks/` vs `app/` split while keeping `app/` as a flat, domain-oriented hook list.

### 2026-03-08 Session 24
- Completed
  - Moved trash warning guidance ownership into `TaskTrashWarningDialog` and removed the guidance prop from App wiring
  - Updated dialog warning view model to carry `workspaceInfo` so guidance/path rendering stay colocated with dialog presentation
  - Removed single-use guidance helper from `App.tsx`
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Metrics
  - `web-ui/src/App.tsx` line count: 1006 (from 1032 before Session 24)
- Notes
  - This keeps single-use UI copy logic at the UI boundary rather than in app-level orchestration.

### 2026-03-08 Session 25
- Completed
  - Moved `getDetailTerminalTaskId` from `App.tsx` into `web-ui/src/kanban/terminal/task-ids.ts`
  - Updated both `App.tsx` and `use-terminal-panels.ts` to import the helper directly from terminal module
  - Removed `getDetailTerminalTaskId` plumbing from `useTerminalPanels` input contract
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Metrics
  - `web-ui/src/App.tsx` line count: 1000 (from 1006 before Session 25)
- Notes
  - Terminal task-id protocol is now centralized at the terminal boundary instead of app composition layer.

### 2026-03-08 Session 26
- Completed
  - Removed standalone `web-ui/src/kanban/terminal/task-ids.ts` and localized detail terminal task-id protocol inside `use-terminal-panels.ts`
  - Updated `useTerminalPanels` to return `homeTerminalTaskId`, so App no longer declares home terminal id/row constants
  - Moved removed-project stream error prefix ownership into `use-project-navigation.ts` via `parseRemovedProjectPathFromStreamError`
  - Removed App-level constants for removed-project prefix and home terminal id/rows
- Validation
  - `npm run lint`
  - `npm run web:typecheck`
  - `npm run web:test`
- Metrics
  - `web-ui/src/App.tsx` line count: 993 (from 1000 before Session 26)
- Notes
  - `App.tsx` now keeps less protocol/constant ownership and more domain-owned boundaries.

## Behavior Map

### Project navigation flow
- Entrypoints
  - `handleSelectProject`
  - `handleAddProject`
  - `handleRemoveProject`
  - `handlePopState`
  - pathname sync effects
- Core transitions
  - update requested project id
  - clear detail selection and inline editor state on project switch
  - reconcile requested id against current runtime snapshot
  - URL replace-state sync on current project changes

### Task create and edit flow
- Entrypoints
  - `handleOpenCreateTask`, `handleCancelCreateTask`, `handleCreateTask`
  - `handleOpenEditTask`, `handleCancelEditTask`, `handleSaveEditedTask`
- Core transitions
  - maintain inline create/edit mutually exclusive state
  - validate prompt and branch selection
  - update board data via `addTaskToColumn` or `updateTask`
  - update per-project last-created branch state

### Task start and drag flow
- Entrypoints
  - `handleStartTask`
  - `handleDragEnd`
  - session-to-board reconciliation effect (sessions -> column changes)
- Core transitions
  - backlog to in-progress kickoff path (`ensureTaskWorkspace` -> `startTaskSession`)
  - auto move in-progress/review based on session state
  - reconcile programmatic animation state and blocked moves

### Trash flow
- Entrypoints
  - `handleMoveToTrash`
  - `handleMoveReviewCardToTrash`
  - `handleOpenClearTrash`, `handleConfirmClearTrash`
  - warning confirm path via `TaskTrashWarningDialog`
- Core transitions
  - optimistic and non-optimistic trash flows
  - warning modal when working changes detected
  - cleanup session + worktree after final trash action

### Terminal flow
- Entrypoints
  - `handleToggleHomeTerminal`
  - `handleToggleDetailTerminal`
  - expand handlers and `mod+j`/`mod+m` hotkeys
  - `handleRunShortcut` terminal targeting branch
- Core transitions
  - open/start terminal session lifecycle per context
  - selection-key guarding for detail terminal startup
  - pane expansion state and height retention

### Git flow
- Entrypoints
  - `runGitAction`
  - `switchHomeBranch`
  - `discardHomeWorkingChanges`
  - `runTaskGitAction` and wrappers
- Core transitions
  - git summary refresh and history refresh
  - action-specific loading/error state handling
  - task prompt synthesis and session input submit behavior for commit/PR actions

## Dependency Map

### Domain: task sessions and workspace APIs
- Key callbacks
  - `ensureTaskWorkspace`, `startTaskSession`, `stopTaskSession`, `sendTaskSessionInput`, `cleanupTaskWorkspace`, `fetchTaskWorkspaceInfo`, `fetchTaskWorkingChangeCount`, `fetchReviewWorkspaceSnapshot`
- Consumes
  - `currentProjectId`, `upsertSession`, `setWorktreeError`
- Mutates
  - `sessions`, `worktreeError`, selected workspace info state via callers
- External dependencies
  - `getRuntimeTrpcClient`, `estimateTaskSessionGeometry`

### Domain: git actions
- Key callbacks
  - `refreshGitSummary`, `runGitAction`, `switchHomeBranch`, `discardHomeWorkingChanges`, `runTaskGitAction`
- Consumes
  - `currentProjectId`, `selectedCard`, `runtimeProjectConfig`, `workspaceSnapshots`, `selectedTaskWorkspaceInfo`
- Mutates
  - `gitSummary`, `runningGitAction`, `gitActionError`, task git loading maps
- External dependencies
  - `useGitHistoryData`, `buildTaskGitActionPrompt`, `showAppToast`

### Domain: terminal panels
- Key callbacks
  - `startHomeTerminalSession`, `handleToggleHomeTerminal`, `startDetailTerminalForCard`, `handleToggleDetailTerminal`, expand/send handlers
- Consumes
  - `currentProjectId`, `workspaceGit`, `selectedCard`, `agentCommand`
- Mutates
  - terminal open/loading/expanded/pane-height states, terminal refs, session summaries
- External dependencies
  - `useTerminalConnectionReady`, `useHotkeys`, `AgentTerminalPanel`

### Domain: project navigation
- Key callbacks and effects
  - `handleSelectProject`, `handleAddProject`, `handleRemoveProject`, `handlePopState`, URL sync effects
- Consumes
  - `currentProjectId`, `projects`, runtime stream snapshot fields
- Mutates
  - `requestedProjectId`, `pendingAddedProjectId`, selection and editor-reset state
- External dependencies
  - `useRuntimeStateStream`, browser history APIs, `getRuntimeTrpcClient`

### Domain: board interactions
- Key callbacks
  - `handleDragEnd`, `handleStartTask`, trash handlers, review comment handlers
- Consumes
  - `board`, `sessions`, selected card context, programmatic move state
- Mutates
  - `board`, `selectedTaskId`, trash warning state, session cleanup side effects
- External dependencies
  - `useProgrammaticCardMoves`, `useLinkedBacklogTaskActions`, board-state helpers

## Compaction Handoff Template
Use this block when handing off after compaction:

```md
### Current status
- Phase: <phase name>
- Completed checklist items:
  - ...
- In progress:
  - ...

### Code changes made
- Files touched:
  - ...
- Behavior notes:
  - ...

### Validation
- Commands run:
  - ...
- Results:
  - ...

### Next exact steps
1. ...
2. ...
3. ...

### Known risks or open questions
- ...
```

## File Convention For Ongoing Updates
- Keep this file updated after each meaningful step.
- Check off items only when fully complete and validated.
- Add brief entries under `Session Work Log` after each work session.
