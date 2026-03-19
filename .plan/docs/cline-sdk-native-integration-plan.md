# Cline SDK Native Integration Plan for Kanban

## Intent and source context

This plan is derived from explicit founder level product direction for Kanban and Cline.

Primary intent to preserve:

- Kanban should keep being agent agnostic for non Cline agents
- Cline should become the default native experience in Kanban
- Cline should not require a separate CLI install for core usage in Kanban
- Cline users should get native auth or provider setup and model selection
- Cline users should get a message based chat UI, not terminal TUI emulation
- terminal emulator path remains for other agents

## Non-goals and hard constraints for implementation

Important founder directive for this migration:

- no legacy compatibility work is required
- no phased migration is required
- no backward-support shims are required for old Cline CLI paths or temporary config shapes

Implementation consequence:

- prefer clean replacement over compatibility adapters
- if config shape changes, write only the new shape and remove transitional compatibility code
- optimize for maintainable target architecture, not migration safety

Condensed source prompt excerpts for handoff context:

> Replace Cline CLI option with a native Cline option powered by SDK.

> In settings, when Cline is selected, user should configure auth or provider and model.

> In detail view agent chat area, Cline should use proper native messages UI similar in spirit to SDK desktop example apps.

> Keep fallback support for other agents through terminal emulator.

> Prioritize architecture quality and engineering quality because this is foundational.

## External SDK reference and dependency strategy

Primary SDK repository reference used by this plan:

- local path during investigation: `/Users/saoud/Repositories/cline-sdk-wip`

High value SDK files to reference during implementation:

- session host and runtime manager
  - `packages/core/src/session/session-host.ts`
  - `packages/core/src/session/default-session-manager.ts`
- provider settings and auth
  - `packages/core/src/storage/provider-settings-manager.ts`
  - `apps/cli/src/commands/rpc-runtime/provider-actions.ts`
  - `apps/cli/src/commands/rpc-runtime/provider-oauth.ts`
- runtime event bridge patterns
  - `apps/cli/src/commands/rpc-runtime/event-bridge.ts`
- DTOs and payload shapes
  - `packages/shared/src/rpc/runtime.ts`
- reference native chat UX patterns
  - `apps/desktop/hooks/use-chat-session.ts`
  - `apps/desktop/components/chat-view.tsx`
  - `apps/desktop/components/chat-messages.tsx`

### Submodule option

You asked whether the SDK should be added as a git submodule. That is viable and likely the cleanest short term path while the SDK is still evolving.

If we do this, recommended layout:

- submodule path: `third_party/cline-sdk`
- pin to explicit commit SHA
- add update docs in internal engineering notes for bump flow

Suggested commands:

```bash
git submodule add <sdk-repo-url> third_party/cline-sdk
git submodule update --init --recursive
```

Recommended package wiring approach with submodule:

- consume built package outputs from submodule packages
- avoid importing from SDK source paths directly in Kanban
- ensure Kanban build and CI can install or build SDK package artifacts deterministically

Alternative to submodule:

- publish or consume versioned SDK packages via registry

Current recommendation:

- use submodule initially if package publishing cadence is not stable yet
- move to versioned package consumption once SDK API surface stabilizes

## Objective

Replace the current `cline` terminal CLI integration in Kanban with a native Cline SDK integration.

What this means in product behavior:

- `cline` is no longer a terminal launched CLI in task sessions
- `cline` task sessions use a native chat UI in detail view
- Cline auth, provider, and model setup is managed directly in Kanban settings
- other agents still use the existing PTY terminal emulator path
- startup no longer prompts users to install Cline CLI

## Migration progress tracker

Last updated: 2026-03-16

- [x] Phase 1, config foundation
  - nested `clineSettings` runtime config is in place
  - no legacy flat-key fallback retained
  - settings contract includes OAuth provider and auth fields
  - Cline install gating removed from default selection flow
- [~] Phase 2, native detail chat UI
  - native `ClineAgentChatPanel` path added for selected agent `cline`
  - task chat send and initial message load now use `runtime.sendTaskChatMessage` and `runtime.getTaskChatMessages`
  - still missing SDK-backed assistant message streaming and persistence
- [~] Phase 3, backend Cline SDK runtime service
  - added `src/cline-sdk/cline-task-session-service.ts` with in-memory Cline session state and message storage
  - runtime API now routes `startTaskSession` / `sendTaskSessionInput` / `stopTaskSession` to Cline session service when a Cline session exists
  - runtime server now creates scoped Cline session services per workspace
  - still missing real SDK session host integration and event adapter wiring
- [~] Phase 4, runtime API surface for chat and provider operations
  - added `runtime.getTaskChatMessages`, `runtime.sendTaskChatMessage`, and `runtime.abortTaskChatTurn` API procedures with contract schemas and validation
  - runtime API tests now cover Cline chat message send/list behavior
  - added `runtime.getClineProviderCatalog`, `runtime.getClineProviderModels`, and `runtime.runClineProviderOAuthLogin` procedures
  - settings UI now fetches provider catalog and model suggestions from runtime procedures and can trigger OAuth login action
  - implementation approach re-validated against SDK references in `cline-sdk-wip` (session host, rpc client, provider actions, oauth handlers)
  - real OAuth login flow handler is still pending (current endpoint returns not wired status)
- [ ] Phase 5, runtime stream integration
  - Cline session summary updates now publish through runtime state hub via `trackClineTaskSessionService`
  - Cline chat messages now emit on runtime stream as `task_chat_message` events from Cline session service listeners
  - connect stream updates to native chat messages UI still pending
- [ ] Phase 6, finish test coverage and stabilization
  - backend integration coverage for SDK runtime branch
  - frontend chat flow coverage for streaming turns and review transitions

## Product scope

In scope:

- native Cline chat execution for Kanban tasks
- provider and model configuration for Cline in settings
- account and OAuth style setup for Cline and supported OAuth providers
- preserving Kanban board semantics and task state transitions

Out of scope:

- replacing non Cline agents with SDK integrations
- redesigning Kanban board interactions unrelated to Cline runtime changes

## Current architecture snapshot

Kanban currently routes all agents through terminal sessions:

- backend session execution: `src/terminal/session-manager.ts`
- per agent launch shaping: `src/terminal/agent-session-adapters.ts`
- runtime start and input endpoints: `src/trpc/runtime-api.ts`
- terminal websocket bridge: `src/terminal/ws-server.ts`
- frontend terminal panel: `web-ui/src/components/detail-panels/agent-terminal-panel.tsx`
- frontend session calls: `web-ui/src/hooks/use-task-sessions.ts`

For Cline specifically, the current path is:

- catalog entry id `cline` in `src/core/agent-catalog.ts`
- binary based install detection in `src/terminal/agent-registry.ts`
- Cline CLI hooks integration in `clineAdapter` inside `src/terminal/agent-session-adapters.ts`

Additional frontend and runtime state touch points that matter for this project:

- app layout and detail panel switching
  - `web-ui/src/App.tsx`
  - `web-ui/src/components/card-detail-view.tsx`
- runtime stream reducer and websocket lifecycle
  - `web-ui/src/runtime/use-runtime-state-stream.ts`
- settings fetch and save queries
  - `web-ui/src/runtime/runtime-config-query.ts`
  - `web-ui/src/runtime/use-runtime-config.ts`
- task startup setup prompts and install dialog behavior
  - `web-ui/src/hooks/use-task-start-service-prompts.ts`
  - `web-ui/src/components/task-start-service-prompt-dialog.tsx`

## Handoff architecture map

This section is for the implementing engineer. It maps current behavior to target behavior with explicit ownership boundaries.

### Current runtime split

- TerminalSessionManager owns process lifecycle and I/O transport for all agents
- runtime-api starts sessions via terminal manager only
- frontend renders terminal panel for detail agent area

### Target runtime split

- New Cline SDK session service owns Cline task execution lifecycle
- TerminalSessionManager remains for non Cline agents and shell terminals
- runtime-api routes by selected agent id
- frontend renders native chat panel for Cline and terminal panel for other agents

### Ownership contract

- Kanban remains source of truth for board state and task session summaries
- SDK service provides turn execution and structured events
- event adapter maps SDK events into Kanban task state updates

## Target architecture

Kanban will support two runtime modes in parallel at the platform level:

1. native SDK runtime mode for `cline`
2. existing PTY terminal runtime mode for all other agents

The selected agent id still drives runtime behavior, but for `cline` the backend will invoke SDK session APIs instead of spawning a PTY process.

## Core design decisions

### 1. Keep task state ownership in Kanban

Kanban keeps ownership of board column logic and task session summaries. SDK events are adapted into Kanban state transitions, not the other way around.

Reason:

- avoids rewriting board orchestration
- keeps review, trash, and auto review flows stable

### 2. Add a dedicated Cline SDK task runtime service

Create a new backend module, for example `src/cline-sdk/`, with a service that:

- owns a single `createSessionHost(...)` instance per workspace process
- maps `taskId` to SDK `sessionId`
- starts turns, sends prompts, aborts turns, and stops sessions
- emits normalized task events for UI and state updates

Reason:

- isolates SDK specific code from terminal manager
- makes the runtime API branch for `cline` explicit and testable

### 3. Add chat specific APIs instead of tunneling through terminal I/O

Add explicit runtime chat endpoints for Cline tasks:

- `startTaskChatSession` for initial task prompt or resume
- `sendTaskChatMessage`
- `abortTaskChatTurn`
- `listTaskChatMessages`

Reason:

- avoids abusing terminal websocket protocols for non terminal UX
- gives typed payloads and deterministic UI behavior

Proposed procedure names to keep API naming aligned with existing router style:

- `runtime.startTaskChatSession`
- `runtime.sendTaskChatMessage`
- `runtime.abortTaskChatTurn`
- `runtime.getTaskChatMessages`
- `runtime.getClineProviderCatalog`
- `runtime.getClineProviderModels`
- `runtime.saveClineProviderSettings`
- `runtime.runClineProviderOAuthLogin`

### 4. Manage provider and auth in Kanban settings

Add provider settings actions in runtime API for `cline` path:

- list providers
- list provider models
- save provider settings
- run provider OAuth login
- optional Cline account info endpoint

Mandatory support level for auth flows:

- support Cline account OAuth/login flow as first-class path
- support provider API-key flow as first-class path
- support OAuth providers that SDK already supports in runtime handlers (`cline`, `oca`, `openai-codex`)

Auth/account references in SDK:

- `cline-sdk-wip/apps/cli/src/commands/rpc-runtime/provider-actions.ts`
- `cline-sdk-wip/apps/cli/src/commands/rpc-runtime/provider-oauth.ts`
- `cline-sdk-wip/packages/llms/src/providers/types/settings.ts`

Note for implementer:

- provider and model plus apiKey/baseUrl are not the full auth model for OAuth providers
- OAuth paths also involve persisted auth fields such as `accessToken`, `refreshToken`, `accountId`, and expiry metadata, as represented by SDK provider settings

Implementation should follow the patterns used in SDK examples and CLI runtime provider actions:

- provider actions pattern from `cline-sdk-wip/apps/cli/src/commands/rpc-runtime/provider-actions.ts`
- OAuth flow pattern from `cline-sdk-wip/apps/cli/src/commands/rpc-runtime/provider-oauth.ts`

## Backend implementation plan

### A. Dependencies and package integration

Add SDK dependencies to Kanban backend package:

- `@cline/core/server`
- `@cline/llms`
- optional `@cline/shared` for shared types

Use a deterministic dependency strategy that works in this repo for development and CI.

Implementation notes:

- if submodule is used, avoid ad hoc relative source imports into `third_party/cline-sdk/packages/*/src`
- import from package entrypoints only, same style as normal npm dependency
- verify Node compatibility with SDK package runtime assumptions

### B. New Cline SDK runtime service

Add modules:

- `src/cline-sdk/task-session-manager.ts`
- `src/cline-sdk/provider-settings-service.ts`
- `src/cline-sdk/event-adapter.ts`

Responsibilities:

- create and cache SDK session host
- start task linked sessions with task metadata
- send message turns with optional file or image inputs
- convert SDK `CoreSessionEvent` stream into Kanban runtime events
- maintain in memory per task transcript cache and message list index

Concrete interfaces to define in this module:

- `startTaskSession(input)`
- `sendTaskMessage(input)`
- `abortTaskTurn(input)`
- `stopTaskSession(input)`
- `getTaskMessages(input)`
- `subscribeTaskEvents(listener)`

Suggested files:

- `src/cline-sdk/cline-task-session-service.ts`
- `src/cline-sdk/cline-task-event-adapter.ts`
- `src/cline-sdk/cline-provider-service.ts`
- `src/cline-sdk/cline-task-types.ts`

Suggested event normalization model:

- raw SDK event -> normalized Cline task event with fields:
  - `workspaceId`
  - `taskId`
  - `sessionId`
  - `turnId`
  - `eventType`
  - `payload`
  - `occurredAt`

### C. Runtime API changes

Update `src/trpc/runtime-api.ts` and `src/trpc/app-router.ts`:

- branch task start for `cline` to SDK manager
- keep existing terminal start path for non `cline`
- add new procedures for chat send, abort, and history read
- add new procedures for provider settings and OAuth actions

Add schema and type updates in:

- `src/core/api-contract.ts`
- `src/core/api-validation.ts`

Also update these runtime server wiring points for dependency injection:

- `src/cli.ts` where runtime server dependencies are composed
- `src/server/runtime-server.ts` where runtime API is created
- `src/trpc/app-router.ts` where procedures are declared and typed

Add unit coverage for parser functions in `src/core/api-validation.ts` for each new chat and provider payload.

### D. Session summary mapping for board behavior

Map SDK lifecycle to existing `RuntimeTaskSessionSummary` values:

- active turn: `running`
- waiting for user input or turn completed with user attention: `awaiting_review`
- user abort: `interrupted`
- terminal failure equivalent: `failed`

Keep these fields updated:

- `lastOutputAt`
- `reviewReason`
- `latestHookActivity` style metadata equivalent for UI badges and activity context

Mapping guidance from SDK side:

- for stream text deltas, update `lastOutputAt`
- for tool start or end events, map into `latestHookActivity.toolName` and `latestHookActivity.activityText`
- when SDK requests user input or pauses for attention, set `state=awaiting_review` and `reviewReason=attention`
- when turn finishes successfully and more user input is needed, keep `awaiting_review`
- when task session is actively running a turn, set `running`

### E. Remove Cline CLI install gating

Current setup prompts include missing agent CLI checks. For native Cline:

- `cline` should be considered available by default
- `agent_cli` prompt should not block Cline task start
- task start setup prompts should only apply where still relevant

Likely touch points:

- `src/terminal/agent-registry.ts`
- `src/config/runtime-config.ts`
- `web-ui/src/hooks/use-task-start-service-prompts.ts`

Specific expected behavior change:

- if selected agent is `cline`, no prompt should tell user to install Cline CLI
- instead, if provider is not configured, prompt should route user to Cline settings setup

## Frontend implementation plan

### A. Native chat panel

Add new detail panel component set:

- `web-ui/src/components/detail-panels/cline-agent-chat-panel.tsx`
- `web-ui/src/components/detail-panels/cline-agent-chat-messages.tsx`
- `web-ui/src/components/detail-panels/cline-agent-chat-input.tsx`

Behavior:

- display user and assistant messages
- show streaming text updates during in flight turn
- render tool call status blocks and errors
- support stop or abort action

Suggested component split for maintainability:

- `cline-agent-chat-panel.tsx` container, orchestration, toolbar
- `cline-agent-chat-message-list.tsx` rendering and virtualization if needed later
- `cline-agent-chat-composer.tsx` input and send actions
- `agent-chat-empty-state.tsx` provider setup and onboarding CTA
- `agent-chat-status-banner.tsx` runtime state and error banners

### B. Chat session hook

Add:

- `web-ui/src/hooks/use-cline-chat-session.ts`

Responsibilities:

- start and resume task chat sessions
- send prompts and stream partial output
- fetch and hydrate message history for selected task
- expose status flags for UI controls

Suggested hook API:

- `messages`
- `status`
- `error`
- `sendMessage(text)`
- `abortTurn()`
- `reloadHistory()`
- `hasProviderConfig`
- `providerSetupState`

### C. Integrate into detail view

Update `web-ui/src/components/card-detail-view.tsx`:

- if selected runtime agent is `cline`, render native chat panel
- keep terminal panel for non Cline agents
- keep bottom shell terminal panel unchanged

Integration detail:

- update `CardDetailView` props and `App.tsx` callsite to pass selected runtime agent id into detail area panel switch
- keep existing diff panel behavior unchanged
- keep review comment insertion flows compatible with both panel types

### D. Settings dialog updates

Update `web-ui/src/components/runtime-settings-dialog.tsx`:

- when selected agent is `cline`, show Cline configuration section
- provider selector
- model selector
- auth setup actions including OAuth login trigger
- account state indicators

Account/auth UX must cover both modes:

- mode A: Cline account sign-in (OAuth) and account state display
- mode B: direct provider credentials (API key/base URL/model)

Minimum account UI expectations:

- explicit sign-in button for Cline account flow
- signed-in status indicator
- sign-out or re-auth action
- fallback to manual provider settings when account mode is not selected

Add new settings hooks and query helpers:

- `web-ui/src/runtime/cline-provider-query.ts`
- `web-ui/src/hooks/use-cline-provider-settings.ts`

Settings UX requirements for implementing engineer:

- provider list and install state should render only under selected `cline`
- model dropdown should refresh when provider changes
- OAuth login action should show pending and success or failure feedback
- API key entry should support masked input and save without leaking value in logs
- include account mode and provider mode language that matches Cline user expectations

## API contract additions

Add typed request and response contracts for:

- task chat message stream snapshots
- chat send and abort mutations
- provider catalog responses
- provider model responses
- provider settings save payloads
- OAuth login trigger and status payload

Add corresponding zod schemas and parser coverage in runtime validation.

Additions expected in `src/core/api-contract.ts`:

- chat message type schema
- chat turn state schema
- chat transcript response schema
- provider catalog and provider models response schemas
- provider settings request schema
- OAuth login trigger response schema

Mirror frontend types through `web-ui/src/runtime/types.ts` re export pipeline.

## Event model and streaming strategy

Two valid approaches exist:

1. stream chat deltas through existing runtime state websocket as new message types
2. expose a dedicated chat websocket endpoint for per task chat stream

Recommended:

- start with option 1 to reuse existing app level stream lifecycle
- include task id and turn id in each delta event
- keep reducer logic scoped to task specific chat store

Reason:

- lower platform surface area
- easier integration with existing reconnect behavior in `use-runtime-state-stream.ts`

Concrete runtime stream additions if using existing websocket:

- new `runtime_state` stream message variants:
  - `task_chat_delta`
  - `task_chat_turn_started`
  - `task_chat_turn_completed`
  - `task_chat_error`

Reducer implementation target:

- `web-ui/src/runtime/use-runtime-state-stream.ts`

Alternative if reducer churn becomes high:

- add dedicated `/api/runtime/chat/ws` endpoint and isolate chat stream state in a separate hook.

## Data persistence and recovery

Store enough data to rehydrate chat view after reload:

- taskId to sdkSessionId mapping in workspace state metadata
- recent message list persisted through SDK session artifacts
- current turn status for each active task

On app reconnect:

- reload persisted message list
- if turn is in progress, resume stream subscription and continue UI updates

Suggested persistence location options:

- in memory map in Cline task session service for active sessions
- persisted mapping in workspace session metadata for restart recovery

Recommendation:

- start with in memory for active process lifetime
- persist message history via SDK artifacts and fetch on demand to keep first implementation simpler

## UX behavior requirements

### Start task

- user starts task in backlog
- if selected agent is `cline`, start SDK task session
- open detail view with native chat
- render initial assistant output stream

### Provider setup path

- if no valid provider config is available, show clear setup state in settings and in chat panel
- include direct action to open settings from chat panel empty state

Detailed user journey:

1. user picks `cline` in settings
2. settings shows provider and model setup section
3. user either signs in or saves provider credentials
4. user starts task from backlog
5. detail view opens native message panel
6. responses stream as chat messages

### Errors

- auth error: explicit message with action to reauthenticate
- provider model mismatch: message with model picker action
- runtime crash: keep task in failed state and preserve logs/messages for debugging

Required error surfaces:

- inline error banner in chat panel
- toast for recoverable actions
- persisted state marker in task summary so board state is accurate after reload

## Security and operational constraints

- never log raw provider secrets in runtime events or traces
- redact API keys in any error serialization
- validate provider base URLs before save
- ensure OAuth callback or token handling uses secure local flow only

Additional constraints:

- do not serialize API keys in runtime state websocket payloads
- redact sensitive provider fields in any debug output
- ensure provider save endpoints validate and trim inputs

## Testing plan

### Backend tests

Add or update tests in:

- `test/runtime/trpc/runtime-api.test.ts`
- new `test/runtime/cline-sdk/task-session-manager.test.ts`
- `test/runtime/config/runtime-config.test.ts`

Coverage focus:

- `cline` routes to SDK manager
- non `cline` routes still use terminal manager
- task summary transitions are correct for SDK events
- provider settings actions parse and persist correctly

Additional backend test targets:

- new Cline provider service tests around OAuth action wiring
- event adapter tests that map SDK events to task summary transitions
- regression tests to verify non Cline agents still go through `TerminalSessionManager`

### Frontend tests

Add or update tests in:

- new `web-ui/src/hooks/use-cline-chat-session.test.tsx`
- `web-ui/src/hooks/use-task-sessions.test.tsx`
- new `web-ui/src/components/detail-panels/cline-agent-chat-panel.test.tsx`

Coverage focus:

- chat streaming updates append correctly
- settings provider model save flow
- detail panel switches chat vs terminal by selected agent

Additional frontend test targets:

- chat panel empty state when provider is missing
- settings section visibility toggles based on selected agent
- abort button disables correctly during pending turn

### Validation commands

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm --prefix web-ui run typecheck`
- `npm --prefix web-ui run test`

## Work breakdown checklist

1. add SDK dependencies and bootstrap service modules
2. implement Cline SDK task session manager with task state adapter
3. extend runtime API and contract schemas for chat and provider actions
4. wire runtime app router procedures and backend service dependencies
5. add native chat panel and chat hook in web UI
6. integrate chat panel into detail view for `cline`
7. extend settings dialog with provider and model configuration UI
8. remove Cline CLI install gating and update task start prompt behavior
9. add and update tests
10. run lint, typecheck, and tests and fix regressions

## File level implementation map

This map is intended for direct implementation handoff.

### Backend

- `src/core/agent-catalog.ts`
  - change Cline label and install semantics to native integration messaging
- `src/terminal/agent-registry.ts`
  - treat `cline` availability as native, not binary gated
- `src/config/runtime-config.ts`
  - keep default agent as `cline`, but remove assumptions that imply Cline CLI install requirement
- `src/trpc/runtime-api.ts`
  - route `startTaskSession` by agent id
  - add chat and provider methods
- `src/trpc/app-router.ts`
  - declare and type new procedures
- `src/core/api-contract.ts`
  - add new zod schemas and TS types
- `src/core/api-validation.ts`
  - add parser helpers for new payloads
- `src/cli.ts`
  - wire Cline SDK service dependencies into runtime API factory path

### Frontend

- `web-ui/src/components/runtime-settings-dialog.tsx`
  - add Cline provider and model section
- `web-ui/src/App.tsx`
  - pass selected agent context to detail panel switch logic
- `web-ui/src/components/card-detail-view.tsx`
  - render native chat panel for Cline
- `web-ui/src/hooks/use-task-sessions.ts`
  - keep existing methods for non Cline
  - add chat specific methods or delegate to new chat hook
- `web-ui/src/runtime/runtime-config-query.ts`
  - add Cline provider query and mutation helpers
- `web-ui/src/runtime/use-runtime-state-stream.ts`
  - support new chat event message types if stream reuse approach is chosen
- `web-ui/src/hooks/use-task-start-service-prompts.ts`
  - remove Cline CLI install prompt for native Cline path

## Key file touch map

Backend likely files:

- `src/core/api-contract.ts`
- `src/core/api-validation.ts`
- `src/trpc/app-router.ts`
- `src/trpc/runtime-api.ts`
- new `src/cline-sdk/*`
- `src/config/runtime-config.ts`
- `src/terminal/agent-registry.ts`

Frontend likely files:

- `web-ui/src/components/runtime-settings-dialog.tsx`
- `web-ui/src/components/card-detail-view.tsx`
- new `web-ui/src/components/detail-panels/cline-agent-chat-*.tsx`
- new `web-ui/src/hooks/use-cline-chat-session.ts`
- `web-ui/src/runtime/runtime-config-query.ts`
- new `web-ui/src/runtime/cline-provider-query.ts`
- `web-ui/src/hooks/use-task-start-service-prompts.ts`

## Acceptance criteria

- selecting `cline` starts a native SDK chat session, not a PTY terminal session
- detail view for Cline shows message based native chat UI with streaming output
- settings provide a working provider and model setup flow for Cline
- Cline can run with account or provider configuration without separate Cline CLI install
- non Cline agents continue to run through terminal emulator unchanged
- full project lint, typecheck, and tests pass after implementation

## Engineering handoff checklist

Before coding:

- align on SDK dependency strategy with repo maintainers
- confirm whether submodule path will be used and committed
- confirm final naming for new runtime procedures

Before merge:

- verify Cline settings and auth flow manually in UI
- verify task lifecycle transitions for Cline path and non Cline path
- verify no regressions to shell terminal and shortcuts
- verify all validators pass
