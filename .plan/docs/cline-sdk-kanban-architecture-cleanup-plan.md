# Cline SDK Kanban Architecture Cleanup Plan

## Purpose

This document defines the target architecture for the Cline SDK integration in Kanban after the prototype work captured in commits:

- `25ba59f6c57555539860bff20c6bec4da3566e75`
- `ce98aecb75d8e493f828e6455292f18ff074d729`
- `0a6f8f68a6d7d74e2c1207453133617449d62cac`

This is not a prototype-enablement plan. It is a cleanup and consolidation plan for getting the feature into a shape we can build on without accumulating avoidable tech debt.

This doc assumes:

- we cannot make SDK changes right now
- we can design Kanban so future SDK improvements slot in cleanly
- non Cline agents must continue working through the existing terminal runtime
- Cline must remain a native chat experience, not a PTY-backed terminal experience
- Kanban currently has zero users for this feature area, so migration safety is not a goal for this cleanup

This doc should be treated as the architecture source of truth for the cleanup pass.

Related docs:

- [Prototype integration plan](./cline-sdk-native-integration-plan.md)
- [Architecture cleanup handoff tracker](./cline-sdk-kanban-architecture-cleanup-handoff.md)

## Compaction Resume Rule

Whenever a future session resumes after compaction or otherwise starts without full short-term context, the first step must be to reread:

- this plan
- the handoff tracker
- any currently relevant implementation files for the active phase

At minimum, early cleanup resumes should reread:

- `src/trpc/runtime-api.ts`
- `src/cline-sdk/cline-provider-service.ts`
- `src/cline-sdk/sdk-provider-boundary.ts`
- `src/cline-sdk/sdk-runtime-boundary.ts`
- `src/cline-sdk/cline-session-runtime.ts`
- `src/cline-sdk/cline-message-repository.ts`
- `src/cline-sdk/cline-task-session-service.ts`
- `src/cline-sdk/cline-event-adapter.ts`
- `src/cline-sdk/cline-session-state.ts`
- `src/config/runtime-config.ts`
- `web-ui/src/hooks/use-cline-chat-session.ts`
- `web-ui/src/hooks/use-cline-chat-runtime-actions.ts`
- `web-ui/src/hooks/use-cline-chat-panel-controller.ts`
- `web-ui/src/hooks/use-runtime-settings-cline-controller.ts`
- `web-ui/src/hooks/use-home-sidebar-agent-panel.tsx`
- `web-ui/src/components/detail-panels/cline-chat-message-item.tsx`
- `web-ui/src/components/detail-panels/cline-agent-chat-panel.tsx`
- `web-ui/src/components/card-detail-view.tsx`
- `web-ui/src/components/runtime-settings-dialog.tsx`
- `web-ui/src/hooks/use-cline-chat-runtime-actions.test.tsx`
- `web-ui/src/hooks/use-cline-chat-panel-controller.test.tsx`
- `web-ui/src/hooks/use-runtime-settings-cline-controller.test.tsx`
- `web-ui/tests/smoke.spec.ts`
- `test/runtime/cline-sdk/cline-message-repository.test.ts`

If additional files become central to the active phase, they should be added to the handoff tracker so future sessions can catch up quickly and avoid introducing cleanup regressions.

## Executive Summary

The current implementation works, but the ownership boundaries are not clean enough yet.

The biggest architectural issue is that Kanban currently duplicates SDK-owned concerns:

- provider settings
- OAuth token persistence
- OAuth refresh policy
- model and provider catalog wiring
- session history persistence behavior

That duplication is concentrated mainly in:

- `src/trpc/runtime-api.ts`
- `src/config/runtime-config.ts`
- `src/cline-sdk/cline-task-session-service.ts`
- `web-ui/src/components/runtime-settings-dialog.tsx`

The correct direction is:

- Kanban owns board state, worktrees, generic session summaries, and UI composition
- the SDK owns provider settings, OAuth state, OAuth refresh, and persisted session artifacts
- Kanban adds a thin Cline integration layer that translates between Kanban concepts and SDK concepts
- `runtime-api` becomes a coordinator, not the home for all Cline logic

## Hard Constraints

The cleanup must honor these constraints:

- No changes to the SDK repository are allowed in this phase
- Kanban must only rely on SDK public entrypoints, not SDK internal source files
- Cline must not require a separate CLI install to function as the selected agent
- Other agents must remain PTY-backed and continue to use the current terminal infrastructure
- Home sidebar support must remain functional
- We do not need to preserve legacy prototype config shapes, migration paths, or backward compatibility for existing users
- Current board semantics must remain intact:
  - running
  - awaiting review
  - interrupted
  - failed
- Each refactor phase must produce a runnable, testable result

## Current State Review

### What is good and should stay

- The product split is correct:
  - native chat for Cline
  - terminal panels for other agents
- The lazy import fix in `src/cli.ts` is correct and should stay
- The Cline chat panel direction is good
- The runtime state hub already has a reasonable streaming shape for summaries and chat messages
- The home sidebar session work is good enough to keep as a second-order concern, not the first cleanup target

### What is currently fragile

- `src/trpc/runtime-api.ts` owns too many responsibilities:
  - request parsing
  - task cwd resolution
  - Cline provider resolution
  - OAuth refresh logic
  - provider catalog lookups
  - provider model lookups
  - OAuth login orchestration
  - home session special-casing
  - session start policy
  - checkpoint policy
- `src/cline-sdk/cline-task-session-service.ts` still owns task-oriented turn orchestration, even after session runtime ownership, entry storage, and event translation are split out
- Kanban stores Cline provider and OAuth data in runtime config even though the SDK already has a provider settings store
- Kanban mirrors provider state into the SDK `ProviderSettingsManager` instead of treating SDK storage as the source of truth
- Chat history is still partly treated as in-memory Kanban state even though the SDK already persists session artifacts
- Cline is still modeled like a CLI agent in the agent catalog, which leaks wrong assumptions into install detection and `effectiveCommand`

### Architectural mismatch with the SDK

The SDK explicitly treats these as core-owned concerns:

- provider settings persistence
- OAuth refresh ownership
- session persistence
- session history loading

That shows up in:

- `packages/core/src/session/default-session-manager.ts`
- `packages/core/src/session/runtime-oauth-token-manager.ts`
- `packages/core/src/session/session-manager.ts`
- `packages/core/README.md`
- `ARCHITECTURE.md`

Kanban should integrate with those boundaries, not recreate them locally.

## Architecture Principles

This cleanup should follow these principles.

### 1. One source of truth per concern

Every concern needs one clear owner.

- Board and review state: Kanban
- Worktree lifecycle: Kanban
- Terminal sessions for non Cline agents: Kanban
- Cline provider settings and secrets: SDK
- Cline OAuth refresh: SDK
- Cline persisted session artifacts: SDK
- Cline chat rendering state for active UI surfaces: Kanban

### 2. Native and terminal runtimes must share a platform shape, not an implementation

Kanban should support multiple agent runtime modes, but they should plug into one platform contract. The contract should be generic. The implementations should be specialized.

### 3. Cline logic should be isolated behind a Kanban-owned integration boundary

All SDK interaction should go through a small set of Kanban modules. Most of the app should not import SDK types or helpers directly.

### 4. UI should react to capabilities, not hardcoded agent IDs

The system currently branches on `selectedAgentId === "cline"` in many places. The target design should move toward capability-based decisions such as:

- `runtimeKind: "native_chat" | "cli_terminal"`
- `supportsProviderSettings`
- `supportsNativeMessages`

### 5. Cleanup should remove duplication, not relocate it

Moving helper functions out of `runtime-api.ts` is not enough if the same duplicated policy still exists in multiple places.

### 6. Prefer clean replacement over compatibility scaffolding

Because there are currently zero users depending on this feature area, we should not spend time on:

- migration shims
- legacy config support
- backward compatibility glue
- transitional adapters kept only for safety

If the clean architecture requires changing prototype-era shapes or deleting prototype-only paths, we should do that.

## Target System Model

Kanban should expose three runtime modes:

1. Task-scoped native chat runtime
2. Task-scoped CLI terminal runtime
3. Workspace-scoped shell terminal runtime

For now:

- Cline uses task-scoped native chat runtime
- Claude, Codex, Gemini, OpenCode, and Droid use task-scoped CLI terminal runtime
- shell terminals stay on the existing bottom terminal path

## Ownership Boundaries

### Kanban-owned concerns

- board state
- task lifecycle and review lifecycle
- task worktree creation and deletion
- task session summary shape used by the board
- runtime websocket fanout to the web UI
- home sidebar synthetic session identity
- generic panel composition in the UI
- non Cline terminal process lifecycle

### SDK-owned concerns

- provider settings persistence
- provider model catalog lookup
- OAuth login flow implementation
- OAuth token refresh policy
- session artifact persistence
- session artifact history reads
- low-level session lifecycle for Cline native sessions

### Kanban integration layer concerns

- map `taskId` to SDK `sessionId`
- map SDK events to Kanban summary transitions
- expose typed runtime procedures for the web UI
- provide provider actions to the settings UI
- provide task-oriented chat actions to detail and home surfaces

## Target Module Layout

The target layout on the Kanban side should look roughly like this:

### Backend integration boundary

- `src/cline-sdk/sdk-runtime-boundary.ts`
  - the only place allowed to import SDK runtime/session APIs
- `src/cline-sdk/sdk-provider-boundary.ts`
  - the only place allowed to import SDK provider and OAuth APIs

### Cline runtime modules

- `src/cline-sdk/cline-session-runtime.ts`
  - owns workspace-scoped session host creation and task-to-session mapping
- `src/cline-sdk/cline-event-adapter.ts`
  - pure mapping from SDK events to Kanban summary/message mutations
- `src/cline-sdk/cline-session-state.ts`
  - owns in-memory summary/message mutation helpers and active-turn bookkeeping
- `src/cline-sdk/cline-message-repository.ts`
  - owns message hydration from SDK session artifacts plus active in-memory delta cache
- `src/cline-sdk/cline-provider-service.ts`
  - owns provider catalog, provider state reads, provider saves, OAuth login, and any provider validation
- `src/cline-sdk/cline-session-types.ts`
  - normalized Cline integration types used by Kanban

### Generic runtime orchestration

- `src/agent-runtime/agent-runtime-service.ts`
  - generic interface used by runtime API
- `src/agent-runtime/native-chat-runtime.ts`
  - interface for native chat backends
- `src/agent-runtime/cli-terminal-runtime.ts`
  - interface for PTY-backed backends
- `src/agent-runtime/agent-capabilities.ts`
  - capability definitions by agent

### Frontend orchestration

- `web-ui/src/hooks/use-agent-panel-controller.ts`
  - chooses native chat vs terminal panel by capability
- `web-ui/src/hooks/use-cline-session-controller.ts`
  - shared chat/controller logic for detail and home surfaces
- `web-ui/src/components/detail-panels/cline-chat/`
  - presentational Cline chat pieces split by responsibility

This structure is intentionally stricter than the prototype.

## Integration Boundary Rules

These rules should be treated as hard rules during the cleanup.

### Rule 1

Only the backend integration boundary files may import from the SDK package entrypoints.

### Rule 2

Kanban must not import from SDK `src/` files or internal paths.

### Rule 3

`runtime-api.ts` must never directly call:

- `createSessionHost`
- `ProviderSettingsManager`
- `getValidClineCredentials`
- `loginClineOAuth`
- `llmsModels`

Those calls should move into the dedicated Cline integration services.

### Rule 4

The web UI must never know about SDK storage layout or token semantics.

### Rule 5

Kanban runtime config must not persist secret Cline provider credentials or OAuth tokens once the cleanup is complete.

## Config and Persistence Strategy

### What Kanban config should keep

Kanban config should keep only Kanban-owned preferences:

- `selectedAgentId`
- project-level shortcut settings
- project-level review/notification settings
- optional per-project Cline selection defaults if product still wants them:
  - selected provider id
  - selected model id

### What Kanban config should stop storing

Kanban config should stop storing:

- Cline API keys
- OAuth access tokens
- OAuth refresh tokens
- OAuth account IDs
- OAuth expiry timestamps
- provider auth-mode details that the SDK already owns

### What the SDK store should own

The SDK provider store should own:

- provider enablement
- API key
- base URL
- OAuth tokens
- OAuth refresh data
- account identity and auth metadata

### Transitional note

Because we cannot change the SDK, the cleanup should adapt Kanban around the SDK store that already exists instead of creating another local abstraction that mirrors it.

## Session and Message Strategy

### Active session runtime

The Cline session runtime should own:

- one workspace-scoped session host
- `taskId -> sessionId` mapping
- active turn state
- subscriptions to SDK session events

### Persisted history

Persisted history should come from SDK session artifacts through the SDK session manager API when possible.

Kanban should not treat in-memory message state as the long-term canonical record.

### In-memory cache

Kanban may keep a lightweight in-memory cache only for:

- active delta assembly
- tool block incremental updates
- mapping current UI state to persisted history

That cache should be disposable and reconstructable.

## Summary State Mapping

Kanban should keep its current `RuntimeTaskSessionSummary` model for the board. The Cline integration layer should map into that model consistently.

Recommended mapping:

- active turn running: `running`
- waiting for user attention after a hook or prompt: `awaiting_review`
- turn completed and ready for user follow-up: `awaiting_review`
- user-aborted turn: `interrupted`
- launch or runtime failure: `failed`
- no active turn but existing session: `idle`

Required summary fields to keep accurate:

- `updatedAt`
- `lastOutputAt`
- `reviewReason`
- `latestHookActivity`
- `latestTurnCheckpoint`
- `previousTurnCheckpoint`

## Agent Capability Model

The target design should replace ad hoc `cline` special cases with capabilities.

Suggested capability model:

- `runtimeKind`
  - `native_chat`
  - `cli_terminal`
  - `workspace_shell`
- `requiresInstalledBinary`
- `supportsNativeMessages`
- `supportsProviderConfiguration`
- `supportsOAuthConfiguration`

Immediate consequence:

- Cline should no longer be treated as requiring an installed binary for task start
- install gating should apply only to CLI-backed agents

## Runtime API Target Shape

The current runtime API should move toward this shape.

### Generic session operations

- `startTaskSession`
- `stopTaskSession`
- `sendTaskSessionInput`

These remain generic, but they route through the appropriate backend service.

### Native chat operations

- `getTaskChatMessages`
- `sendTaskChatMessage`
- `abortTaskChatTurn`
- `cancelTaskChatTurn`

These remain task-oriented because the Kanban product is task-oriented, even if the backend implementation uses SDK session IDs under the hood.

### Provider operations

Provider operations should be backed by the dedicated provider service, not `runtime-api.ts` helpers.

- `getClineProviderCatalog`
- `getClineProviderModels`
- `runClineProviderOAuthLogin`
- add a provider state read endpoint if needed
- add a provider save endpoint if the UI cannot use generic config save cleanly

## Frontend Target Shape

### Detail view

The detail view should render through one controller that decides which panel to mount by agent capability.

Target split:

- `AgentPanelHost`
  - chooses native chat panel or terminal panel
- `ClineChatPanelContainer`
  - data/controller layer
- `ClineChatMessageList`
  - display layer
- `ClineChatComposer`
  - input layer
- `ClineToolCallBlock`
  - tool rendering layer

### Home sidebar

The home sidebar should reuse the same controller and view contracts as the detail view where possible.

The synthetic home session identity is acceptable for now because:

- it solves a real product need
- it is already isolated in `src/core/home-agent-session.ts`
- making workspace-scoped native sessions a first-class platform type is not the first cleanup priority

### Settings UI

The settings dialog should stop being responsible for auth-policy decisions.

It should only:

- read provider state
- show available providers and models
- dispatch provider updates
- dispatch OAuth login actions

It should not reconstruct SDK auth semantics locally.

## What to Keep, What to Delete, What to Move

### Keep

- lazy runtime import fix in `src/cli.ts`
- home session helper module in `src/core/home-agent-session.ts`
- native chat UI direction
- runtime state hub chat message streaming pattern

### Delete or fold away

- direct SDK auth and provider helpers inside `src/trpc/runtime-api.ts`
- duplicated provider resolution logic spread across config, API, and settings UI
- any remaining assumption that Cline is just another installed CLI command

### Move behind dedicated services

- provider catalog and model lookup
- provider save logic
- OAuth login wiring
- Cline launch config resolution
- task-to-session binding
- raw SDK event handling

## Phased Refactor Plan

Each phase is intended to end in a runnable and testable system state.

### Phase 1: Establish the boundary

Goal:

- isolate all SDK imports behind explicit Kanban wrapper modules

Deliverables:

- dedicated SDK runtime boundary module
- dedicated SDK provider boundary module
- no direct SDK imports from `runtime-api.ts`
- no direct SDK imports from generic runtime files outside the Cline integration area

Verification:

- typecheck passes
- runtime behavior unchanged
- targeted tests still pass

### Phase 2: Separate provider ownership

Goal:

- move provider and OAuth orchestration out of `runtime-api.ts`

Deliverables:

- `cline-provider-service`
- settings UI reads provider state through the service-backed API
- `runtime-api.ts` delegates all provider actions
- Kanban stops deciding token refresh policy itself

Verification:

- provider catalog works
- provider models load
- OAuth login works
- Codex and other non Cline runtimes do not accidentally touch Cline auth

### Phase 3: Separate native session ownership

Goal:

- split the Cline session service into runtime, event adapter, and message repository pieces

Deliverables:

- workspace-scoped Cline session runtime
- pure event adapter tests
- session-state module that owns in-memory summary and message mutations
- session-to-task binding module
- message hydration through repository layer

Verification:

- task start works for Cline
- send, abort, cancel, and stop work
- board summary transitions remain correct
- state stream still updates detail and home surfaces

### Phase 4: Remove duplicated persistence and config debt

Goal:

- stop persisting SDK-owned secrets in Kanban config
- remove prototype-era compatibility handling instead of carrying it forward

Deliverables:

- runtime config trimmed to Kanban-owned preferences
- provider save path writes to SDK store through provider service
- UI no longer depends on Kanban copy of Cline secrets or tokens

Verification:

- settings still survive reload
- provider auth still works after restart
- no secret material leaks into runtime state payloads

### Phase 5: UI consolidation

Goal:

- unify home and detail Cline chat orchestration around one controller shape

Deliverables:

- shared Cline session controller
- slimmer `App.tsx`
- slimmer `runtime-settings-dialog.tsx`
- split presentational chat components

Verification:

- detail view works
- home sidebar works
- project switching and provider switching remain stable

### Phase 6: Hardening and deletion pass

Goal:

- remove leftover compatibility shims, dead helpers, and prototype-only assumptions

Deliverables:

- delete obsolete config code
- delete obsolete runtime helpers
- reduce branching on `selectedAgentId === "cline"`
- add architecture comments only where the code would otherwise be surprising

Verification:

- full test suite
- lint
- typecheck
- focused manual verification of:
  - Cline detail chat
  - Cline home sidebar
  - non Cline task terminal
  - shell terminal
  - provider setup and OAuth

## Testing Strategy

### Backend tests

Focus areas:

- provider service behavior
- session runtime behavior
- event adapter behavior
- runtime API delegation behavior
- state hub streaming behavior

### Frontend tests

Focus areas:

- agent panel routing by capability
- Cline chat controller behavior
- home/detail reuse behavior
- provider settings UI behavior

### Integration checks

Critical integration scenarios:

- start Cline task from backlog
- continue Cline task in detail view
- switch project and return
- send message from home sidebar
- switch provider while home sidebar is visible
- start non Cline agent terminal
- open shell terminal

## Risks and Mitigations

### Risk: silent divergence between SDK store and Kanban config

Mitigation:

- remove duplicated ownership instead of synchronizing forever

### Risk: event adapter regressions break board semantics

Mitigation:

- treat event adapter as a pure module with direct tests for state transitions

### Risk: cleanup accidentally regresses non Cline agents

Mitigation:

- keep generic session orchestration interface explicit
- test terminal runtime path separately from native chat path

### Risk: home sidebar special-casing spreads further

Mitigation:

- keep synthetic home session behavior isolated in a tiny module and avoid adding new call-site-specific logic to generic runtime code

## Future SDK-Friendly Opportunities

These are intentionally out of scope for now, but this Kanban architecture should leave room for them later.

- first-class workspace-scoped native sessions instead of synthetic home session IDs
- SDK-provided provider state DTOs that map directly into Kanban settings UI
- SDK-exposed session message streaming helper tailored for embedded app clients
- SDK-level session metadata that can carry Kanban task IDs directly

## Definition of Done

This cleanup is done when all of the following are true:

- SDK imports are isolated behind dedicated Kanban boundary modules
- `runtime-api.ts` no longer owns provider/auth logic directly
- Cline provider secrets and OAuth tokens are no longer stored in Kanban runtime config
- Cline session runtime is split into smaller, testable modules
- chat history recovery uses SDK persistence instead of mostly in-memory Kanban state
- Cline is modeled by capability, not by pretending it is just another installed CLI
- detail and home chat paths share a coherent controller architecture
- non Cline agents still work through the PTY path without regression

## Recommended First Execution Step

When implementation starts, do not begin with UI cleanup.

Start with:

1. the SDK boundary modules
2. the provider service extraction
3. removing direct SDK auth/provider logic from `runtime-api.ts`

That creates the right spine for everything else and avoids doing UI cleanup on top of unstable backend boundaries.
