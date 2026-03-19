# Cline SDK Kanban Architecture Cleanup Handoff

## Primary Reference

This handoff tracker is subordinate to:

- [Cline SDK Kanban Architecture Cleanup Plan](./cline-sdk-kanban-architecture-cleanup-plan.md)

If this file and the plan ever disagree, the plan wins unless the handoff explicitly records a newer decision with rationale.

## Purpose

This file is the live execution tracker for the architecture cleanup work.

Use it to record:

- current phase
- what has been completed
- what is actively in progress
- what should happen next
- risks, blockers, and non-obvious discoveries

This file should stay concise enough to orient a fresh session quickly, while the linked plan remains the deeper architectural reference.

## Scope Guardrails

The current cleanup assumes:

- no SDK changes for now
- Kanban must adapt around the SDK as it exists today
- Cline remains native chat
- non Cline agents remain PTY-backed
- there are currently zero users to migrate, so backward compatibility and legacy support are not priorities

## Current Overall Status

Status: In progress

Current recommended phase:

- Phase 6: Hardening and deletion pass

Current recommended first task:

- continue Phase 6 with broader verification and a deletion pass for any leftover prototype-only helpers that are no longer used

## Phase Tracker

### Phase 1: Establish the boundary

Status: Complete

Definition:

- isolate all SDK imports behind explicit Kanban wrapper modules

Exit conditions:

- `runtime-api.ts` no longer directly imports SDK auth/session/provider helpers
- generic runtime files outside the Cline integration area do not import SDK modules

### Phase 2: Separate provider ownership

Status: Complete

Definition:

- move provider catalog, provider state, and OAuth behavior behind a dedicated provider service

Exit conditions:

- settings UI uses provider service-backed endpoints
- token refresh policy is not implemented directly in `runtime-api.ts`

### Phase 3: Separate native session ownership

Status: Complete

Definition:

- split the current Cline session service into smaller modules with clear responsibilities

Exit conditions:

- runtime, event adapter, and message repository responsibilities are separated

### Phase 4: Remove duplicated persistence and config debt

Status: Complete

Definition:

- remove SDK-owned secrets and OAuth state from Kanban runtime config

Exit conditions:

- Kanban runtime config stores only Kanban-owned preferences for Cline

### Phase 5: UI consolidation

Status: Complete

Definition:

- unify detail and home chat orchestration around one controller shape

Exit conditions:

- home and detail surfaces share coherent controller logic
- `App.tsx` and settings UI are slimmer

### Phase 6: Hardening and deletion pass

Status: In progress

Definition:

- remove leftover prototype-only code and verify the whole stack

Exit conditions:

- dead helpers removed
- tests, lint, and typecheck pass
- manual verification checklist passes

## Decisions Already Made

These are pre-work decisions that should be treated as established unless the user explicitly changes them.

- Do not change the SDK during this cleanup pass
- Keep the lazy runtime import fix in `src/cli.ts`
- Keep the home sidebar synthetic session identity for now
- Do not treat a first-class workspace native session type as the first cleanup priority
- Treat SDK provider storage as the eventual source of truth for Cline secrets and OAuth state
- Move toward capability-based agent routing instead of spreading more `selectedAgentId === "cline"` checks
- Because there are zero users to migrate, prefer clean replacement over migration scaffolding, backward compatibility work, or legacy prototype support

## Immediate Risks to Watch

- accidentally deepening the current `runtime-api.ts` god-file pattern
- preserving duplicated provider ownership just in smaller files
- doing UI cleanup before backend ownership boundaries are stable
- regressing non Cline agent terminals while refactoring the Cline path

## Files Most Likely To Change Early

- `src/trpc/runtime-api.ts`
- `src/cline-sdk/cline-task-session-service.ts`
- `src/cline-sdk/cline-session-runtime.ts`
- `src/cline-sdk/cline-message-repository.ts`
- `src/cline-sdk/cline-event-adapter.ts`
- `src/cline-sdk/cline-session-state.ts`
- `src/config/runtime-config.ts`
- `src/core/agent-catalog.ts`
- `src/terminal/agent-registry.ts`
- `web-ui/src/components/runtime-settings-dialog.tsx`

New files added or still expected:

- `src/cline-sdk/sdk-runtime-boundary.ts`
- `src/cline-sdk/sdk-provider-boundary.ts`
- `src/cline-sdk/cline-provider-service.ts`
- `src/cline-sdk/cline-event-adapter.ts`
- `src/cline-sdk/cline-session-state.ts`
- `src/cline-sdk/cline-message-repository.ts`
- `src/cline-sdk/cline-session-runtime.ts`
- `web-ui/src/hooks/use-cline-chat-runtime-actions.ts`
- `web-ui/src/hooks/use-cline-chat-panel-controller.ts`
- `web-ui/src/hooks/use-runtime-settings-cline-controller.ts`
- `test/runtime/cline-sdk/cline-message-repository.test.ts`
- `web-ui/src/hooks/use-cline-chat-runtime-actions.test.tsx`
- `web-ui/src/hooks/use-cline-chat-panel-controller.test.tsx`
- `web-ui/src/hooks/use-runtime-settings-cline-controller.test.tsx`

## Verification Checklist

Keep this checklist updated as phases complete.

- [ ] Cline detail view starts and continues native chat sessions
- [ ] Cline home sidebar works across project switches
- [ ] provider catalog and model selection work
- [ ] OAuth login works
- [ ] non Cline task sessions still launch in PTY terminals
- [ ] shell terminal still works
- [x] full backend tests pass
- [x] full web tests pass
- [x] browser smoke tests pass
- [x] lint passes
- [x] typecheck passes

## Session Log

Add newest entries at the top.

### Entry 12

Date:

- Phase 6 browser smoke hardening completed

State:

- updated `web-ui/tests/smoke.spec.ts` to match the current product UX instead of stale prototype-era assumptions
- the smoke spec now covers:
  - top bar and board columns rendering
  - creating a backlog task and reopening it into the inline editor
  - escape-key dismissal of the backlog inline editor
  - opening the runtime settings dialog
- this was mostly a hardening follow-up on stale browser locators and outdated flow assumptions:
  - app branding is `Cline`, not `Kanban`
  - backlog task clicks reopen the inline editor instead of opening the task detail view
  - settings dialog title is `Settings`
  - task creation is submitted through the prompt composer shortcut path, not the old naive Enter assumption

Verification:

- `npm --prefix web-ui run e2e`
- `npm test`
- `npm --prefix web-ui run test`
- `npm run typecheck`
- `npm run web:typecheck`
- `npm run lint`

Next step:

- if we keep going, the only meaningful remaining verification work is true product-level manual smoke on:
  - Cline detail chat
  - home sidebar project switching
  - provider catalog and model loading
  - OAuth login
  - non Cline PTY agents
  - shell terminal
- avoid more architecture refactors unless one of those manual flows exposes a real gap

### Entry 11

Date:

- Phase 6 automated hardening run completed

State:

- ran the full backend test suite with `npm test`
- ran the full web test suite with `npm --prefix web-ui run test`
- reran focused backend and frontend cleanup-area coverage along the way, plus full typecheck and lint
- the cleanup now has strong automated coverage across:
  - Cline provider settings and OAuth flows
  - Cline session runtime and persisted message hydration
  - runtime API orchestration
  - detail-view and home-sidebar chat UI paths
- no obvious leftover prototype-only helper from the final settings-controller pass stood out in the quick sweep

Verification:

- `npm test`
- `npm --prefix web-ui run test`
- `npm run typecheck`
- `npm run web:typecheck`
- `npm run lint`

Next step:

- focus Phase 6 on manual smoke checks for:
  - Cline detail chat
  - home sidebar project switching
  - provider catalog and model loading
  - OAuth login
  - non Cline PTY agents
  - shell terminal
- avoid further structural refactors unless a manual verification failure exposes a real architectural gap

### Entry 10

Date:

- Phase 5 settings cleanup completed

State:

- added `web-ui/src/hooks/use-runtime-settings-cline-controller.ts` so the Cline-specific provider draft state, provider catalog/model loading, provider save flow, and OAuth login flow are no longer embedded directly inside `web-ui/src/components/runtime-settings-dialog.tsx`
- updated `web-ui/src/components/runtime-settings-dialog.tsx` to compose that controller hook and keep the dialog focused on generic settings orchestration plus JSX
- updated `web-ui/src/runtime/runtime-config-query.ts` with Cline settings query helpers so the settings layer no longer talks to TRPC inline for provider catalog, provider models, provider save, or OAuth login
- added focused coverage in `web-ui/src/hooks/use-runtime-settings-cline-controller.test.tsx` for:
  - provider catalog and model loading
  - provider draft save behavior
  - OAuth login state updates
- Phase 5 now feels complete enough to stop refactoring and switch to Phase 6 hardening

Verification:

- `npm --prefix web-ui run test -- --run src/hooks/use-runtime-settings-cline-controller.test.tsx src/hooks/use-cline-chat-session.test.tsx src/hooks/use-cline-chat-panel-controller.test.tsx src/components/detail-panels/cline-agent-chat-panel.test.tsx src/hooks/use-cline-chat-runtime-actions.test.tsx`
- `npm run web:typecheck`
- `npm run lint`

Next step:

- start Phase 6 by running broader verification across backend and web flows
- inspect for any leftover prototype-only helpers or now-unused code paths before committing
- if resuming after compaction, reread the cleanup docs plus the new runtime settings controller hook, its test, the runtime settings dialog, and the runtime config query helpers before continuing

### Entry 9

Date:

- Phase 5 panel and chat-session cleanup continued

State:

- added `web-ui/src/hooks/use-cline-chat-panel-controller.ts` so `web-ui/src/components/detail-panels/cline-agent-chat-panel.tsx` no longer owns most of its draft, send, cancel, and derived action-state logic inline
- added `web-ui/src/components/detail-panels/cline-chat-message-item.tsx` so tool, reasoning, assistant, and system message rendering is separated from the panel container
- simplified `web-ui/src/components/detail-panels/cline-agent-chat-panel.tsx` into a higher-level layout component that composes the new controller hook and message item renderer
- hardened `web-ui/src/hooks/use-cline-chat-session.ts` so:
  - incoming streamed messages are merged instead of being overwritten by a late history load
  - task switches clear stale messages before loading the next task history
  - the shared message upsert logic is reused instead of duplicated
- added focused coverage in:
  - `web-ui/src/hooks/use-cline-chat-panel-controller.test.tsx`
  - `web-ui/src/hooks/use-cline-chat-session.test.tsx`
- the remaining obvious Phase 5 seam is the Cline-specific state and async behavior still embedded inside `web-ui/src/components/runtime-settings-dialog.tsx`

Verification:

- `npm --prefix web-ui run test -- --run src/hooks/use-cline-chat-session.test.tsx src/hooks/use-cline-chat-panel-controller.test.tsx src/components/detail-panels/cline-agent-chat-panel.test.tsx src/hooks/use-cline-chat-runtime-actions.test.tsx`
- `npm run web:typecheck`
- `npm run lint`

Next step:

- inspect `web-ui/src/components/runtime-settings-dialog.tsx` and decide whether to extract a dedicated Cline settings controller hook
- if resuming after compaction, reread the cleanup docs plus the shared Cline runtime-action hook, the panel controller hook, the chat-session hook, the message item component, the panel component, and the settings dialog before making more Phase 5 changes

### Entry 8

Date:

- Phase 5 controller consolidation started

State:

- added `web-ui/src/hooks/use-cline-chat-runtime-actions.ts` so detail view and the home sidebar now share one Cline runtime-action hook for send, load, cancel, and abort behavior plus summary upserts
- updated `web-ui/src/hooks/use-task-sessions.ts` to reuse that shared Cline runtime-action hook instead of carrying its own duplicated TRPC chat orchestration
- updated `web-ui/src/hooks/use-home-sidebar-agent-panel.tsx` to reuse the same shared hook and keep only the home-specific stale-session cleanup logic local
- slimmed `web-ui/src/App.tsx` by removing the detail-view-only Cline callback wrappers and passing the shared task-session callbacks through directly
- updated `web-ui/src/hooks/use-cline-chat-session.ts` so successful sends use the returned runtime chat message immediately instead of always reloading the full chat history
- added focused frontend coverage in:
  - `web-ui/src/hooks/use-cline-chat-runtime-actions.test.tsx`
  - `web-ui/src/hooks/use-cline-chat-session.test.tsx`
- Phase 5 is not complete yet, but the duplicated runtime orchestration seam is now consolidated and future UI cleanup can focus on panel composition instead of backend call drift

Verification:

- `npm --prefix web-ui run test -- --run src/hooks/use-cline-chat-runtime-actions.test.tsx src/hooks/use-cline-chat-session.test.tsx src/hooks/use-task-sessions.test.tsx src/components/detail-panels/cline-agent-chat-panel.test.tsx`
- `npm run web:typecheck`
- `npm run lint`

Next step:

- decide whether to stop Phase 5 after this controller consolidation or keep going by splitting `web-ui/src/components/detail-panels/cline-agent-chat-panel.tsx` into smaller presentational pieces
- if resuming after compaction, reread the two cleanup docs plus the shared Cline runtime-action hook, the chat-session hook, the home sidebar agent hook, and the Cline panel component before making more UI cleanup changes

### Entry 7

Date:

- Phase 3 persisted message hydration completed

State:

- extended `src/cline-sdk/sdk-runtime-boundary.ts` and `src/cline-sdk/cline-session-runtime.ts` so the runtime can read persisted SDK session artifacts for a task without leaking raw SDK imports outside the Cline boundary
- taught `src/cline-sdk/cline-message-repository.ts` to hydrate and cache Kanban chat messages from persisted SDK history while still preferring live in-memory task entries
- added `loadTaskSessionMessages` to `src/cline-sdk/cline-task-session-service.ts` and switched `src/trpc/runtime-api.ts` to use that async hydration path for `getTaskChatMessages`
- added focused regression coverage in:
  - `test/runtime/cline-sdk/cline-message-repository.test.ts`
  - `test/runtime/cline-sdk/cline-session-runtime.test.ts`
  - `test/runtime/trpc/runtime-api.test.ts`
- with message hydration in place, Phase 3 now meets the target deliverables in the cleanup plan and the next sensible cleanup seam is Phase 5 UI consolidation

Verification:

- `npx vitest run test/runtime/cline-sdk/cline-message-repository.test.ts test/runtime/cline-sdk/cline-session-runtime.test.ts test/runtime/cline-sdk/cline-task-session-service.test.ts test/runtime/trpc/runtime-api.test.ts`
- `npm run typecheck`
- `npm run lint`

Next step:

- begin Phase 5 by mapping the overlapping detail-view and home-sidebar Cline chat orchestration into one controller shape
- keep rereading the architecture plan, this handoff, and the active frontend hook files before making more cleanup changes after compaction

### Entry 6

Date:

- Phase 3 repository extraction completed

State:

- added `src/cline-sdk/cline-message-repository.ts` so task entries, summary fanout, and message fanout now live behind their own in-memory repository boundary
- updated `src/cline-sdk/cline-task-session-service.ts` so it now coordinates turns across three dedicated Cline modules:
  - session runtime
  - message repository
  - event adapter
- Phase 3 now has clean seams for:
  - host and session-id ownership
  - event translation
  - in-memory entry and fanout storage
- the main architectural work left in this phase is deciding how to hydrate historical messages and summaries from SDK session artifacts through the new repository without breaking current live updates

Verification:

- `npx vitest run test/runtime/cline-sdk/cline-event-adapter.test.ts test/runtime/cline-sdk/cline-session-runtime.test.ts test/runtime/cline-sdk/cline-task-session-service.test.ts test/runtime/trpc/runtime-api.test.ts`
- `npm run typecheck`
- `npm run lint`

Next step:

- inspect the SDK session artifact read APIs and design the first hydration pass for `cline-message-repository.ts`
- decide whether the first hydration integration should be read-through on `listMessages` and `getSummary` or an eager load when a task session becomes active

### Entry 5

Date:

- Phase 3 runtime extraction and direct seam tests completed

State:

- added `src/cline-sdk/cline-session-runtime.ts` so SDK host creation, host reuse, and taskId <-> sessionId bindings no longer live inside `src/cline-sdk/cline-task-session-service.ts`
- updated `src/cline-sdk/cline-task-session-service.ts` to orchestrate through the new runtime module instead of owning session host state directly
- added direct tests for the new runtime in `test/runtime/cline-sdk/cline-session-runtime.test.ts`
- added direct event adapter tests in `test/runtime/cline-sdk/cline-event-adapter.test.ts`, so summary and message transitions are now covered at the seam where they actually live

Verification:

- `npx vitest run test/runtime/cline-sdk/cline-event-adapter.test.ts test/runtime/cline-sdk/cline-session-runtime.test.ts test/runtime/cline-sdk/cline-task-session-service.test.ts test/runtime/trpc/runtime-api.test.ts`
- `npm run typecheck`
- `npm run lint`

Next step:

- extract an initial `cline-message-repository` that owns entry storage, summary fanout, and message fanout
- decide whether that repository should stay in-memory for one pass or immediately start hydrating from SDK session artifacts

### Entry 4

Date:

- Phase 3 initial extraction completed

State:

- added `src/cline-sdk/cline-event-adapter.ts` so raw SDK event parsing and summary/message transitions are no longer embedded inside `src/cline-sdk/cline-task-session-service.ts`
- added `src/cline-sdk/cline-session-state.ts` so the in-memory Cline entry shape, active-turn bookkeeping, and summary/message mutation helpers now live in one domain module
- slimmed `src/cline-sdk/cline-task-session-service.ts` so it now focuses on session host ownership, task-to-session routing, and task-oriented start and send orchestration
- added module comments to the new Cline runtime files so future cold resumes can quickly understand the boundary

Verification:

- `npx vitest run test/runtime/cline-sdk/cline-task-session-service.test.ts`
- `npx vitest run test/runtime/trpc/runtime-api.test.ts`
- `npm run typecheck`
- `npm run lint`

Next step:

- extract session host creation and task-to-session mapping into a dedicated `cline-session-runtime` or binding-focused module
- decide whether the next repository step should first wrap current in-memory message reads or go straight to SDK-backed history hydration

### Entry 1

Date:

- Cleanup execution began

State:

- Phase 1 started
- compact-resume rule added to both architecture docs

Next step:

- extract direct SDK imports out of `runtime-api.ts`
- create dedicated SDK boundary modules

### Entry 2

Date:

- Phase 1 completed

State:

- added `src/cline-sdk/sdk-runtime-boundary.ts` so session host creation and workspace metadata calls no longer leak out of the Cline integration area
- added `src/cline-sdk/sdk-provider-boundary.ts` so SDK auth, provider catalog, model lookup, and provider settings sync are isolated behind one local boundary
- added `src/cline-sdk/cline-provider-service.ts` and moved Cline launch config, OAuth refresh, provider catalog/model mapping, and OAuth login orchestration out of `src/trpc/runtime-api.ts`
- `src/trpc/runtime-api.ts` now coordinates instead of importing SDK modules directly

Verification:

- `npx vitest run test/runtime/trpc/runtime-api.test.ts`
- `npx vitest run test/runtime/cline-sdk/cline-task-session-service.test.ts`
- `npm run typecheck`
- `npm run lint`

Next step:

- begin Phase 2 by reducing duplicated provider ownership between `runtime-config.ts`, the new provider service, and the settings UI
- decide what Kanban-owned Cline preferences remain in runtime config versus what should move behind the provider service boundary

### Entry 3

Date:

- Phase 2 completed

State:

- added a dedicated `saveClineProviderSettings` runtime mutation so the settings dialog no longer tries to push provider secrets and OAuth blobs through generic `saveConfig`
- changed `runClineProviderOAuthLogin` so OAuth login persists directly to the SDK-backed provider store and returns summarized provider state instead of round-tripping raw tokens through the UI
- moved launch config resolution, provider selection, catalog fallback, and provider summary reads fully onto the SDK-backed provider service
- removed Cline provider state from `src/config/runtime-config.ts`, so runtime config now stores only Kanban-owned settings
- updated the settings dialog to treat OAuth as provider-owned state with status display instead of editable raw token fields

Verification:

- `npx vitest run test/runtime/trpc/runtime-api.test.ts test/runtime/terminal/agent-registry.test.ts`
- `npx vitest run test/runtime/cline-sdk/cline-task-session-service.test.ts`
- `npm --prefix web-ui run test -- --run src/runtime/use-runtime-config.test.tsx src/runtime/use-runtime-project-config.test.tsx`
- `npm run typecheck`
- `npm run web:typecheck`
- `npm run lint`

Next step:

- begin Phase 3 by splitting `src/cline-sdk/cline-task-session-service.ts`
- identify the clean seams between session host ownership, SDK event translation, and chat message storage
- wire the runtime state hub and chat UI to those smaller modules without changing behavior

### Entry 0

Date:

- Initial tracker created after architecture review of prototype commits `25ba59f`, `ce98aec`, and `0a6f8f6`

State:

- no cleanup implementation started yet

Next step:

- begin Phase 1 by creating SDK boundary modules and moving direct SDK imports out of `runtime-api.ts`

## Resume From Here

If a future session starts cold or resumes after compaction, do this first:

1. Read the primary plan:
   - `./cline-sdk-kanban-architecture-cleanup-plan.md`
2. Read this tracker fully
3. Inspect the current state of:
   - `src/trpc/runtime-api.ts`
   - `src/cline-sdk/cline-provider-service.ts`
   - `src/cline-sdk/sdk-provider-boundary.ts`
   - `src/cline-sdk/sdk-runtime-boundary.ts`
   - `src/cline-sdk/cline-session-runtime.ts`
   - `src/cline-sdk/cline-message-repository.ts`
   - `src/cline-sdk/cline-task-session-service.ts`
   - `src/cline-sdk/cline-event-adapter.ts`
   - `src/cline-sdk/cline-session-state.ts`
   - `src/server/runtime-state-hub.ts`
   - `web-ui/src/hooks/use-cline-chat-session.ts`
   - `web-ui/src/hooks/use-cline-chat-runtime-actions.ts`
   - `web-ui/src/hooks/use-cline-chat-panel-controller.ts`
   - `web-ui/src/hooks/use-home-sidebar-agent-panel.tsx`
   - `web-ui/src/components/detail-panels/cline-chat-message-item.tsx`
   - `web-ui/src/components/detail-panels/cline-agent-chat-panel.tsx`
   - `web-ui/src/components/card-detail-view.tsx`
   - `src/config/runtime-config.ts`
   - `web-ui/src/components/runtime-settings-dialog.tsx`
   - `web-ui/src/hooks/use-cline-chat-runtime-actions.test.tsx`
   - `web-ui/src/hooks/use-cline-chat-panel-controller.test.tsx`
   - `test/runtime/cline-sdk/cline-message-repository.test.ts`
   - `test/runtime/cline-sdk/cline-event-adapter.test.ts`
   - `test/runtime/cline-sdk/cline-session-runtime.test.ts`
   - `test/runtime/cline-sdk/cline-task-session-service.test.ts`
4. Confirm whether Phase 5 is the active focus
5. Continue from the current phase instead of starting a new cleanup thread

Compaction rule:

- every time a session resumes after compaction, reread both docs above before making any cleanup changes
- also reread any implementation files most relevant to the active phase
- if the active phase has shifted, update this section with the current must-read files

## Update Rules

Whenever work is done on this cleanup:

- update the relevant phase status
- add a new entry to the session log
- record any non-obvious gotchas or decisions
- keep the next recommended step current

If scope changes materially, update the main plan first, then update this handoff tracker.
