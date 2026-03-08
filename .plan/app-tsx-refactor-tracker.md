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
- [ ] Extract project selection, URL sync, and popstate flows into `useProjectNavigation`
- [ ] Extract add/remove project orchestration into the navigation domain
- [ ] Ensure loading-state behavior parity during project switches

### Phase 6: task editor and board interaction extraction
- [ ] Extract create/edit form state and handlers into `useTaskEditor`
- [ ] Extract drag/start/trash/review-comment orchestration into `useBoardInteractions`
- [ ] Keep programmatic card move integration behavior unchanged

### Phase 7: App shell slimming and cleanup
- [ ] Reduce App to orchestration composition and layout rendering
- [ ] Remove dead state and dead callbacks after extraction
- [ ] Re-run full validation suite
- [ ] Document final architecture summary in this tracker

## Validation Checklist Per Phase
- [ ] Lint passes
- [ ] Typecheck passes
- [ ] Tests pass
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
