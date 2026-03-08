# CLI Runtime Refactor Plan

## Purpose
- Keep a durable source of truth for the `src/cli.ts` refactor.
- Preserve detail across context compaction so future agents can resume without re-deriving architecture decisions.
- Drive an incremental refactor that improves navigability and subsystem clarity without redesigning the product.

## Scope
- In scope:
  - `src/cli.ts`
  - runtime host composition and lifecycle
  - shared CLI and runtime utility extraction
  - workspace, terminal manager, WebSocket, and shutdown orchestration boundaries
- Out of scope:
  - web UI architecture changes
  - TRPC contract redesign
  - MCP protocol redesign
  - broad rewrites that mix behavior changes with structural cleanup

## Baseline Snapshot
- `src/cli.ts` is 1603 lines and currently contains both bootstrap code and long-lived runtime host state.
- The main hotspot is `startServer()`, which owns most mutable maps, timers, and resource lifecycle.
- The extracted TRPC API modules are already a good boundary, but they still depend on closures created in `cli.ts`.

## Refactor Goals
1. Make `cli.ts` a thin bootstrap and composition entrypoint.
2. Move long-lived mutable state into explicit runtime subsystems with clear ownership.
3. Preserve current runtime behavior and external contracts.
4. Optimize for codebase navigability and clarity, not target line counts.
5. Keep each step shippable, reviewable, and testable.

## Non-goals
- No large architecture rewrite.
- No new framework, dependency injection container, or generic event bus.
- No protocol changes unless a small extraction reveals a real design bug.
- No thin wrapper files that only forward calls without owning state or behavior.

## Architectural Principles

### 1. Extract by state ownership
The main split should follow which subsystem owns mutable state and lifecycle, not whether code is HTTP, WebSocket, or TRPC.

### 2. Keep the current contracts
The web UI, MCP server, hooks flow, and TRPC router should keep working with the same runtime contracts while internals are extracted.

### 3. Prefer meaningful subsystems over helper sprawl
If a new file does not own important state, lifecycle, or domain logic, it probably should not exist.

### 4. Let naming settle after the first extractions
The folder shape should support clarity, but we should not overfit directory names before the first real subsystem lands.

### 5. Preserve test leverage
Existing integration coverage around runtime state streaming and workspace state is valuable. Refactors should preserve and build on that coverage.

## Current Responsibility Map

### CLI bootstrap
- parse args
- print help and version
- dispatch `mcp` and `hooks` subcommands
- startup auto-update
- optional agent selection persistence
- existing server detection and browser open
- signal handling

### Shared local utilities
- asset resolution and static file serving helpers
- project path resolution
- shell resolution
- browser launching
- shortcut execution
- filesystem and git validation helpers

### Runtime host state
- active workspace id and path
- runtime config cache for the active workspace
- workspace path registry
- project task count cache
- terminal manager lifecycle and hydration

### Runtime state streaming
- runtime WebSocket server
- client registration by workspace
- task session batching
- workspace file refresh polling
- project and workspace broadcast fanout

### HTTP and transport composition
- HTTP server creation
- static web UI asset handling
- TRPC context creation
- request workspace scope resolution
- terminal WebSocket bridge hookup
- upgrade routing

### Shutdown and cleanup
- identify interrupted sessions
- persist interrupted state to workspace files
- move tasks to trash during shutdown persistence
- delete interrupted worktrees
- close HTTP and WebSocket resources

## Pragmatic Target Shape

The exact folder names are less important than the ownership boundaries. Start conservative. Create a new folder only when the extracted subsystem is real and cohesive.

Preferred default home for new server-side host code:

```txt
src/runtime/server/
```

If that feels too broad after the first extraction, it is acceptable to rename to `runtime/host` later. The boundary matters more than the label.

## Proposed Subsystems

### Shared utilities
Small, pure, or platform-specific helpers that are currently duplicated or mixed into `cli.ts`.

Candidate files:

```txt
src/runtime/projects/project-path.ts
src/runtime/server/browser.ts
src/runtime/server/shell.ts
src/runtime/server/assets.ts
```

### Workspace registry
Owns the runtime host's workspace-centric state and terminal manager lifecycle.

Proposed home:

```txt
src/runtime/server/workspace-registry.ts
```

This should likely become the single source of truth for:
- active workspace id and path
- workspace path lookup by workspace id
- active runtime config cache
- terminal manager creation and hydration
- project pruning for removed or invalid repos
- project summaries and task counts
- workspace snapshot building

### Runtime state hub
Owns runtime WebSocket clients, timers, event batching, and broadcast fanout.

Proposed home:

```txt
src/runtime/server/runtime-state-hub.ts
```

This should own:
- runtime WebSocket server behavior
- workspace client registration and cleanup
- task session summary batching
- workspace file refresh intervals
- broadcast helpers for project and workspace updates

### HTTP host
Owns HTTP server setup, TRPC handler wiring, static assets, and WebSocket upgrade routing.

Proposed home:

```txt
src/runtime/server/http-host.ts
```

This should own:
- `createServer(...)`
- TRPC HTTP handler creation
- request workspace scope resolution
- runtime and terminal WebSocket upgrade routing
- static asset serving and SPA fallback

### Shutdown coordinator
Owns interruption persistence and cleanup sequencing during process shutdown.

Proposed home:

```txt
src/runtime/server/shutdown.ts
```

This should own:
- interrupted session selection
- persistence of interrupted sessions
- trash move logic during shutdown save
- interrupted worktree cleanup
- close and shutdown choreography

## First-pass Dependency Graph

```txt
cli.ts
  -> createRuntimeServer()
       -> workspaceRegistry
       -> runtimeStateHub
       -> httpHost
       -> shutdown coordinator

TRPC API modules
  -> depend on narrow capabilities exposed by workspaceRegistry and runtimeStateHub

MCP and hooks entrypoints
  -> remain separate and keep their current external behavior
```

## Function Move Map

This section is here to help future agents move code without re-reading the whole file from scratch.

### Move to shared utilities
- `getWebUiDir`
- `shouldFallbackToIndexHtml`
- `normalizeRequestPath`
- `resolveAssetPath`
- `readAsset`
- `openInBrowser`
- `resolveProjectInputPath`
- `resolveInteractiveShellCommand`
- `assertPathIsDirectory`
- `pathIsDirectory`
- `hasGitRepository`
- `getProjectName`

Notes:
- `resolveProjectInputPath` is duplicated in `src/runtime/mcp/server.ts` and should be centralized first.
- `assets.ts` should stay small and focused on request-path and file loading concerns.

### Move to workspace registry
- `createEmptyProjectTaskCounts`
- `countTasksByColumn`
- `collectProjectWorktreeTaskIdsForRemoval`
- `applyLiveSessionStateToProjectTaskCounts`
- `toProjectSummary`
- `getActiveWorkspacePath`
- `getActiveWorkspaceId`
- `getTerminalManagerForWorkspace`
- `ensureTerminalManagerForWorkspace`
- `setActiveWorkspace`
- `clearActiveWorkspace`
- `disposeWorkspaceRuntimeResources`
- `pruneMissingWorkspaceEntries`
- `summarizeProjectTaskCounts`
- `buildWorkspaceStateSnapshot`
- `buildProjectsPayload`
- `resolveWorkspaceForStream`

### Move to runtime state hub
- `sendRuntimeStateMessage`
- `flushWorkspaceFileChangeBroadcast`
- `queueWorkspaceFileChangeBroadcast`
- `disposeWorkspaceFileChangeBroadcast`
- `ensureWorkspaceFileRefresh`
- `disposeWorkspaceFileRefresh`
- `flushTaskSessionSummaries`
- `queueTaskSessionSummaryBroadcast`
- `disposeTaskSessionSummaryBroadcast`
- `ensureTerminalSummarySubscription`
- `broadcastRuntimeWorkspaceStateUpdated`
- `broadcastRuntimeProjectsUpdated`
- runtime state WebSocket `connection` handling logic
- runtime state WebSocket client cleanup logic

### Move to HTTP host
- `readWorkspaceIdFromRequest`
- `sendJson`
- `resolveWorkspaceScopeFromRequest`
- TRPC handler creation
- HTTP request handler for `/api/trpc`, `/api/*`, and static assets
- HTTP upgrade routing for runtime state WebSocket server
- terminal WebSocket bridge integration

### Move to shutdown coordinator
- `moveTaskToTrash`
- `persistInterruptedSessions`
- `cleanupInterruptedTaskWorktrees`
- `shouldInterruptSessionOnShutdown`
- `collectShutdownInterruptedTaskIds`
- `close`
- `shutdown`

## Recommended Implementation Order

### Phase 0: extract shared utilities
This is the safest starting point.

Primary goals:
- remove obvious duplication
- shrink `cli.ts` a little without changing state ownership yet
- establish the first stable homes for reusable host-side helpers

Suggested first moves:
- `resolveProjectInputPath`
- browser open helper
- shell resolution helper
- asset loading and request-path helpers

Acceptance criteria:
- duplicated project-path resolution is gone
- no behavior change in CLI bootstrap or MCP server
- new utility files are small and cohesive

Completed in the first slice:
- extracted `resolveProjectInputPath` to `src/runtime/projects/project-path.ts`
- extracted browser launch helper to `src/runtime/server/browser.ts`
- extracted interactive shell resolution to `src/runtime/server/shell.ts`
- extracted web UI asset helpers to `src/runtime/server/assets.ts`
- updated `src/cli.ts` and `src/runtime/mcp/server.ts` to consume the shared utilities

### Phase 1: extract workspace registry
This is the highest-value architectural slice.

Primary goals:
- make workspace and terminal-manager state explicit
- stop storing core host state as anonymous local closures inside `startServer()`

Suggested public capabilities for the registry:
- `getActiveWorkspaceId()`
- `getActiveWorkspacePath()`
- `setActiveWorkspace(...)`
- `clearActiveWorkspace()`
- `getTerminalManagerForWorkspace(...)`
- `ensureTerminalManagerForWorkspace(...)`
- `buildWorkspaceStateSnapshot(...)`
- `buildProjectsPayload(...)`
- `resolveWorkspaceForStream(...)`
- `disposeWorkspaceRuntimeResources(...)`

Acceptance criteria:
- `createProjectsApi` and `createWorkspaceApi` depend on registry capabilities instead of `cli.ts` local closures
- terminal manager hydration still works on startup
- workspace switching and project removal behavior remain unchanged

Completed in the second slice:
- extracted `src/runtime/server/workspace-registry.ts`
- moved active workspace ownership, runtime config caching, terminal manager lifecycle, workspace snapshot building, and project summary building into the registry
- rewired `src/cli.ts` TRPC context creation to depend on registry capabilities instead of ad hoc local state
- updated `projects-api` and `hooks-api` dependency contracts to consume registry-backed methods
- preserved existing runtime state stream and workspace integration behavior under the current tests

### Phase 2: extract runtime state hub
This is the next meaningful subsystem after registry extraction.

Primary goals:
- isolate WebSocket clients, timers, and fanout logic
- make realtime lifecycle testable without bootstrapping the full CLI entrypoint

Suggested public capabilities:
- register runtime WS upgrades and connections
- broadcast workspace updates
- broadcast project updates
- subscribe to terminal manager summaries
- clean up workspace-scoped realtime resources
- close all realtime resources

Acceptance criteria:
- runtime state stream integration tests still pass
- workspace removal still disconnects or resyncs clients correctly
- timers and subscriptions are disposed correctly on shutdown

Completed in the third slice:
- extracted `src/runtime/server/runtime-state-hub.ts`
- moved runtime WebSocket client ownership, workspace file refresh timers, terminal summary batching, and realtime cleanup into the hub
- rewired `src/cli.ts` to delegate runtime WS upgrades and broadcasts to the hub while keeping terminal WS handling local for now
- simplified `hooks-api` so it depends on `broadcastTaskReadyForReview` instead of raw websocket client maps
- preserved runtime stream integration behavior under the existing tests

### Phase 3: extract HTTP host and runtime server composition
Primary goals:
- move transport wiring out of `cli.ts`
- make the composition root obvious

Suggested outputs:
- `createHttpHost(...)`
- `createRuntimeServer(...)`

Acceptance criteria:
- `cli.ts` becomes mostly bootstrap and signal handling
- transport wiring is easy to find in one place
- TRPC context creation is still centralized and readable

Completed in the fourth slice:
- extracted `src/runtime/server/runtime-server.ts`
- moved HTTP asset serving, TRPC handler creation, runtime WS upgrade routing, terminal WS bridge setup, and server close logic into the runtime server module
- rewired `src/cli.ts` to build registry and hub dependencies, then delegate HTTP host composition to `createRuntimeServer`
- kept workspace-aware TRPC context construction centralized inside the runtime server module
- preserved runtime stream integration coverage after the extraction

### Phase 4: extract shutdown coordinator
Primary goals:
- isolate shutdown-specific mutation and cleanup logic
- make shutdown behavior easier to reason about and test

Acceptance criteria:
- shutdown sequence is unchanged
- interrupted session persistence and worktree cleanup are still correct

Completed in the fifth slice:
- extracted `src/runtime/server/shutdown-coordinator.ts`
- moved interrupted session collection, persistence, worktree cleanup, and final close sequencing into the shutdown coordinator
- rewired `src/cli.ts` to delegate shutdown lifecycle work instead of owning the sequencing inline
- preserved runtime state stream shutdown behavior under the existing integration tests

## File Organization Guardrails

### Good signs
- a file owns durable state, lifecycle, or a clear domain workflow
- the file has a narrow and obvious public surface
- related code paths become easier to find without searching the entire repo

### Bad signs
- a new file only re-exports or forwards two or three calls
- a subsystem is split across multiple folders without a strong reason
- a file is named around a transport detail even though it owns domain state
- line count drops, but the dependency graph becomes harder to follow

## Test Strategy During Refactor

After each phase, run the relevant validators and keep the existing integration coverage green.

Important existing coverage to preserve:
- `test/integration/runtime-state-stream.integration.test.ts`
- `test/integration/workspace-state.integration.test.ts`
- `test/runtime/trpc/hooks-api.test.ts`
- `test/runtime/terminal/session-manager.test.ts`

If a new subsystem becomes substantial, add focused unit tests for that subsystem rather than only relying on end-to-end tests.

## Known Risks
- State ownership can get worse if the registry boundary is split too early.
- WebSocket cleanup and timer disposal are easy places for regressions.
- Runtime config caching for the active workspace should stay simple; do not create a second config cache abstraction unless a real problem appears.
- Project pruning and active workspace fallback are cross-cutting behaviors and should keep one clear owner.

## Open Questions
- Use `runtime/server` or `runtime/host` as the long-term folder name?
  - Current recommendation: start with `runtime/server` and revisit only if it becomes awkward.
- Should project summary and task-count helpers live inside the registry or a separate `projects` helper module?
  - Current recommendation: keep them with the registry first, split later only if they become independently reusable.
- Should `getWebUiDir` live with asset helpers or in runtime server composition?
  - Current recommendation: place it with asset helpers unless composition needs a more explicit runtime asset contract.

## Working Rules For Future Agents
1. Do not perform a broad rewrite.
2. Keep each step behavior-preserving.
3. Prefer moving code into a subsystem first, then simplifying within that subsystem.
4. Update this document when the plan changes materially.
5. Record completed phases and any deviations from the intended boundaries.
6. When in doubt, choose the smaller extraction that creates a real ownership boundary.

## Progress Tracker

- [x] Phase 0: extract shared utilities used by `cli.ts` and MCP server
- [x] Phase 1: extract workspace registry
- [x] Phase 2: extract runtime state hub
- [x] Phase 3: extract HTTP host and runtime server composition
- [x] Phase 4: extract shutdown coordinator
- [ ] Final cleanup: reduce `cli.ts` to bootstrap and signal wiring only

## Immediate Next Slice

The most pragmatic next step is Final cleanup:

1. decide whether the remaining CLI-local helpers should stay as entrypoint concerns or move into smaller runtime modules
2. keep `src/cli.ts` focused on command parsing, startup fallback behavior, browser opening, and signal wiring
3. avoid extracting tiny wrappers that only move code without clarifying ownership
4. stop once the file is easy to navigate and each remaining helper is clearly CLI-specific

At this point the biggest runtime ownership boundaries are extracted, so the last step should be a restraint pass rather than another large move.
