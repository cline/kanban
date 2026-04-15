## Desktop runtime simplification checklist

Goal: simplify `feature/desktop-app` to a **single-runtime model** where the desktop app is just a native shell around one known Kanban runtime endpoint.

### Target behavior
- On launch, desktop checks the configured/local runtime endpoint (default `127.0.0.1:3484`).
- If healthy, desktop attaches to it.
- If not healthy, desktop starts the Kanban runtime process and waits for health.
- If runtime disconnects, desktop shows a recovery UI instead of doing failover/election.
- Multi-window is just multiple BrowserWindows pointed at the same runtime URL.

### Product rule to adopt explicitly
- There is **one local runtime authority**.
- Desktop does **not** do runtime discovery/election/failover across multiple runtimes.
- Desktop and CLI both target the same configured endpoint.

---

## File-by-file checklist

### `packages/desktop/src/main.ts`
- [x] Remove runtime descriptor watcher logic.
- [x] Remove runtime authority negotiation / attach-to-descriptor logic.
- [x] Replace boot flow with:
  - [x] check configured runtime health
  - [x] attach if healthy
  - [x] otherwise start runtime process
  - [x] wait for health, then load windows
- [x] Replace disconnect handling with recovery UI flow:
  - [x] RuntimeChildManager auto-restarts (up to 3x)
  - [x] renderer recovery shows reload/dismiss dialog on crash/fail
  - [x] dedicated `disconnected.html` page shown when max restarts exceeded
  - [x] terminal command hint (`kanban`) displayed in disconnected state
  - [x] Restart button wired via `window.desktop.restartRuntime()` → IPC → `restartRuntime()`
- [x] Keep multi-window behavior loading the same runtime URL.

### `packages/desktop/src/connection-manager.ts`
- [x] **Deleted.** No longer needed — the simplified main.ts handles the single-endpoint flow directly.

### `packages/desktop/src/connection-store.ts`
- [x] **Deleted.** Desktop no longer supports multiple saved/manual connections.

### `packages/desktop/src/connection-menu.ts`
- [x] **Deleted.** Desktop no longer exposes connection switching.

### `packages/desktop/src/connection-utils.ts`
- [x] **Deleted.** `isInsecureRemoteUrl` helper only served the connection manager.

### `packages/desktop/src/auth.ts`
- [x] **Deleted.** Auth header interceptor replaced by simple cookie set in main.ts.

### `packages/desktop/src/desktop-boot-state.ts`
- [x] **Deleted.** Complex boot state machine replaced by simple `runtimeUrl` null check.

### `packages/desktop/src/desktop-failure-codes.ts`
- [x] **Deleted.** Failure code enum only served the boot state machine.

### `packages/desktop/src/desktop-failure.ts`
- [x] **Deleted.** Failure dialog only served the boot state machine.

### `packages/desktop/src/orphan-cleanup.ts`
- [x] **Deleted.** Orphan process cleanup only served the descriptor trust system.

### `packages/desktop/src/renderer-recovery.ts`
- [x] **Deleted.** Inlined as `attachSimpleRecovery()` in main.ts — just reloads the URL, no ConnectionManager dependency.

### `packages/desktop/src/runtime-child.ts`
- [x] **Kept as-is.** Desktop still forks the bundled runtime child entry point. Works well for the single-runtime model.

### `packages/desktop/src/kanban.d.ts`
- [x] Remove declarations for deleted shared runtime-discovery/takeover APIs.
- [x] Keep only imports actually used by simplified desktop main process.

---

### `src/core/runtime-descriptor.ts`
- [ ] **Deferred.** Still used by CLI-side resolution. Desktop no longer imports it. Can be simplified further when CLI adopts the same single-endpoint model.

### `src/core/runtime-takeover.ts`
- [ ] **Deferred.** Desktop no longer imports it. Still exists for CLI failover use cases. Can be removed when product rule is fully adopted.

### `src/core/runtime-endpoint.ts`
- [ ] **Deferred.** Descriptor-first resolution still exists for CLI clients. Desktop bypasses it entirely (direct health check on known port). Can be simplified when CLI drops descriptor usage.

### `src/runtime-start.ts`
- [x] **Kept.** Desktop's runtime-child-entry.ts still uses `startRuntime()` from this module. The API surface is already minimal.

### `src/cli.ts`
- [ ] **Deferred.** CLI still uses descriptor-based attach. Not blocking desktop simplification.

### `src/server/runtime-server.ts`
- [ ] **Deferred.** Auth bootstrap and workspace watcher are server-side concerns. Not blocking desktop simplification.

### `src/server/workspace-state-watcher.ts`
- [ ] **Deferred.** Still useful if CLI and desktop runtimes coexist on the same machine writing to shared state directories. Not blocking desktop simplification.

### `src/server/auth-middleware.ts`
- [ ] **Deferred.** Localhost auth simplification is a server-side concern. Desktop works around it via cookie injection. Passcode protections for remote mode preserved.

### `src/core/kanban-command.ts`
- [x] **Kept.** Desktop uses the CLI shim path for the runtime child's `KANBAN_CLI_COMMAND` env var.

### `src/core/scoped-command.ts`
- [ ] **Deferred.** Not related to desktop simplification.

### `src/core/shell.ts`
- [x] **Kept.** Not directly used by desktop but still needed by runtime internals.

---

## Tests to remove/update

### Deleted tests for removed architecture
- [x] `packages/desktop/test/auth.test.ts`
- [x] `packages/desktop/test/connection-manager.test.ts`
- [x] `packages/desktop/test/connection-menu.test.ts`
- [x] `packages/desktop/test/connection-store.test.ts`
- [x] `packages/desktop/test/descriptor-trust.test.ts`
- [x] `packages/desktop/test/desktop-boot-state.test.ts`
- [x] `packages/desktop/test/desktop-failure.test.ts`
- [x] `packages/desktop/test/main-connection-integration.test.ts`
- [x] `packages/desktop/test/menu-gating.test.ts`
- [x] `packages/desktop/test/orphan-cleanup.test.ts`
- [x] `packages/desktop/test/renderer-recovery.test.ts`

### Tests kept (still valid)
- [x] `packages/desktop/test/cli-shim.test.ts`
- [x] `packages/desktop/test/desktop-preflight.test.ts`
- [x] `packages/desktop/test/ipc-protocol.test.ts`
- [x] `packages/desktop/test/main.test.ts` (window state persistence)
- [x] `packages/desktop/test/notarize.test.ts`
- [x] `packages/desktop/test/oauth-relay.test.ts`
- [x] `packages/desktop/test/protocol-handler.test.ts`
- [x] `packages/desktop/test/runtime-child-manager.test.ts`
- [x] `packages/desktop/test/runtime-child.test.ts`
- [x] `packages/desktop/test/window-registry.test.ts`
- [x] `packages/desktop/test/window-state.test.ts`

### Deferred — shared runtime tests
- [ ] `test/runtime/core/resolve-runtime-connection.test.ts` — still valid for CLI resolution
- [ ] `test/runtime/workspace-state-watcher.test.ts` — still valid for server-side sync
- [ ] `test/runtime/core/runtime-takeover.test.ts` — still valid for CLI failover

### TODO — new tests for simplified model
- [ ] desktop attaches to existing runtime on configured endpoint
- [ ] desktop starts runtime if endpoint is down
- [ ] desktop does not spawn duplicate runtime when one is already healthy
- [ ] desktop multi-window loads same runtime URL
- [ ] runtime disconnect shows recovery UI
- [ ] restart/retry action reconnects successfully

---

## Implementation order (updated)

1. [x] Decide final product rule for endpoint config (`3484` only vs shared configurable endpoint). → Default `127.0.0.1:3484`.
2. [x] Simplify desktop boot flow in `main.ts`.
3. [x] Replace connection manager with direct health check + child start in main.ts.
4. [x] Remove connection switching / descriptor / takeover usage from desktop.
5. [x] Delete desktop-side multi-runtime coordination files (10 source + 11 test files).
6. [ ] Simplify server auth/bootstrap/watcher code made obsolete by single-runtime model.
7. [ ] Add new tests for simplified desktop model.
8. [ ] Do one end-to-end smoke pass:
   - [ ] existing runtime attach
   - [ ] cold start
   - [ ] disconnect + restart
   - [ ] multi-window

---

## Non-goals
- No runtime authority election.
- No descriptor-based discovery.
- No automatic failover/takeover between desktop and CLI runtimes.
- No multi-connection management in desktop unless product scope explicitly keeps it.

---

## Summary of changes (2026-04-14)

**Deleted 10 source files, 11 test files. Rewrote main.ts from 1254 → ~760 lines. Added disconnected screen.**

Net: +671 / -5,511 lines across 27 changed files.

Desktop `packages/desktop/src/` went from 21 files → 12 files:
- `desktop-preflight.ts` — kept (startup validation)
- `disconnected.html` — **new** (styled "Runtime Disconnected" page with Restart button and `kanban` terminal hint)
- `ipc-protocol.ts` — kept (parent↔child message types)
- `kanban.d.ts` — trimmed (removed descriptor/takeover types)
- `main.ts` — **rewritten** (lean health-check-or-start flow + `showDisconnectedScreen()` + `restart-runtime` IPC)
- `oauth-relay.ts` — kept (OAuth callback forwarding)
- `preload.ts` — updated (added `restartRuntime()` IPC bridge for disconnected screen)
- `protocol-handler.ts` — kept (kanban:// deep links)
- `runtime-child-entry.ts` — kept (child process bootstrap)
- `runtime-child.ts` — kept (RuntimeChildManager)
- `window-registry.ts` — kept (multi-window management)
- `window-state.ts` — kept (window persistence)

Build: `npm run build:ts` compiles TypeScript + bundles preload + copies `disconnected.html` to `dist/`. All 579 existing tests pass (4 pre-existing failures from missing `@clinebot/rpc` dependency unrelated to this work).
