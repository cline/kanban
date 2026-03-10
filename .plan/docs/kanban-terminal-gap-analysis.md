# Kanban Terminal Gap Analysis

Date: March 10, 2026

Purpose: compare the current Kanban terminal stack against the WebSSH2 reference investigation and turn that research into a concrete implementation plan for fixing the xterm, transport, and PTY lifecycle.

## Executive summary

The current Kanban terminal implementation is no longer in the worst place it started from. We already moved to:

- binary websocket transport for terminal I/O
- `AttachAddon` instead of custom JSON terminal framing
- `FitAddon`, `ClipboardAddon`, `WebLinksAddon`, and optional `WebglAddon`
- split I/O and control channels

That was the right direction.

The remaining problems are structural:

- session startup geometry is still estimated or fake in multiple entry points
- terminal semantics still depend on whether input came from the real terminal surface or from app code
- websocket output batching exists, but there is no real backpressure plan
- the browser, websocket bridge, and PTY manager do not share one explicit lifecycle contract
- tests do not yet protect the terminal behaviors that users actually notice

The main lesson from WebSSH2 is not "copy this SSH app". The lesson is that terminal boundaries need to be owned deliberately:

- one place decides initial terminal geometry
- one place defines how typed input differs from paste input
- one transport layer owns buffering rules
- one session contract describes what can happen before attach, during attach, after resize, and after exit

That is the piece Kanban is still missing.

## Reference set

Primary Kanban files reviewed:

- `web-ui/src/terminal/use-terminal-session.ts`
- `web-ui/src/hooks/use-task-sessions.ts`
- `web-ui/src/hooks/use-terminal-panels.ts`
- `web-ui/src/runtime/task-session-geometry.ts`
- `src/terminal/ws-server.ts`
- `src/terminal/session-manager.ts`
- `src/terminal/pty-session.ts`
- `src/terminal/terminal-session-service.ts`
- `src/trpc/runtime-api.ts`
- `.plan/docs/terminal-emulator-investigation.md`

Primary WebSSH2 references reviewed:

- `/Users/saoud/Repositories/kanban-idea/webssh2/app/socket/adapters/service-socket-terminal.ts`
- `/Users/saoud/Repositories/kanban-idea/webssh2/app/socket/adapters/ssh-config.ts`
- `/Users/saoud/Repositories/kanban-idea/webssh2/tests/unit/stream-backpressure.vitest.ts`
- `/Users/saoud/Repositories/kanban-idea/webssh2/tests/playwright/e2e-term-size-replay-v2.spec.ts`
- `.plan/docs/webssh2-reference-investigation.md`

## Current Kanban architecture

Today the stack roughly looks like this:

```text
React panel / hook
  -> creates xterm instance
  -> fits terminal locally
  -> opens IO websocket
  -> opens control websocket
  -> registers controller for app-driven input

runtime.startTaskSession / runtime.startShellSession
  -> sends estimated cols/rows before terminal mount is actually stable

WebSocket bridge
  -> IO socket forwards raw data to PTY
  -> control socket forwards resize / stop and state / exit

TerminalSessionManager
  -> spawns node-pty session
  -> replays history to new listeners
  -> resizes PTY
  -> stores summary state
```

That architecture is serviceable, but the startup contract is weak. Different code paths make different assumptions about when geometry is known, where paste semantics live, and how transport pressure should be handled.

## What WebSSH2 gets right that matters here

These are the pieces worth stealing conceptually:

### 1. Initial geometry is first class

WebSSH2 stores early terminal settings and uses them when the shell is actually opened. `buildTerminalDefaults()` reads `initialTermSettings` so the terminal does not need to start blind and fix itself later.

Relevant refs:

- `/Users/saoud/Repositories/kanban-idea/webssh2/app/socket/adapters/ssh-config.ts:97`
- `/Users/saoud/Repositories/kanban-idea/webssh2/app/socket/adapters/service-socket-terminal.ts:116`

The matching test coverage also checks that the terminal dimensions are not just default placeholders and that resize actually changes `stty size`.

Relevant refs:

- `/Users/saoud/Repositories/kanban-idea/webssh2/tests/playwright/e2e-term-size-replay-v2.spec.ts:94`
- `/Users/saoud/Repositories/kanban-idea/webssh2/tests/playwright/e2e-term-size-replay-v2.spec.ts:151`

### 2. Backpressure is a named concern

WebSSH2 has explicit backpressure helpers:

- `getWebSocketBufferedBytes()`
- `computeBackpressureAction()`

and unit tests around their decisions.

Relevant refs:

- `/Users/saoud/Repositories/kanban-idea/webssh2/app/socket/adapters/service-socket-terminal.ts:31`
- `/Users/saoud/Repositories/kanban-idea/webssh2/app/socket/adapters/service-socket-terminal.ts:69`
- `/Users/saoud/Repositories/kanban-idea/webssh2/tests/unit/stream-backpressure.vitest.ts:171`

Kanban currently batches output, but batching is not the same as flow control.

### 3. Terminal responsibilities stay near the terminal adapter

In WebSSH2, terminal sizing, stream hookup, and resize deferral live together in the socket terminal adapter. Even though the app is larger than a toy example, terminal behavior still has a clear owner.

Kanban has the same pieces split across:

- `use-terminal-session.ts`
- `use-task-sessions.ts`
- `use-terminal-panels.ts`
- `runtime-api.ts`
- `session-manager.ts`

That split is the biggest reason the implementation feels improvised.

## Highest leverage Kanban gaps

## 1. Initial geometry is still guessed, not negotiated

This is the largest remaining UX problem.

Task sessions are started with estimated geometry based on viewport math:

- `web-ui/src/hooks/use-task-sessions.ts:108`
- `web-ui/src/runtime/task-session-geometry.ts:13`

Shell sessions still start with fixed rows and rough column estimation:

- `web-ui/src/hooks/use-terminal-panels.ts:9`
- `web-ui/src/hooks/use-terminal-panels.ts:14`
- `web-ui/src/hooks/use-terminal-panels.ts:138`
- `web-ui/src/hooks/use-terminal-panels.ts:192`

Server-side, the PTY falls back to `120x40` when geometry is missing:

- `src/terminal/session-manager.ts:204`
- `src/terminal/session-manager.ts:446`

What this means in practice:

- the process can boot at the wrong size
- TUIs can layout at the wrong size
- the frontend then calls `fit()` and sends a later resize
- the first visually stable frame may already be a corrected frame, not the original frame

This is exactly the "jerk into place" failure mode the earlier investigation identified.

Why WebSSH2 is better here:

- it preserves initial terminal settings before the shell is fully ready
- its tests assert that the shell sees real terminal dimensions, not just defaults

Recommendation:

- stop treating initial geometry as an estimate attached to `startTaskSession`
- introduce a bootstrap phase where the mounted xterm measures itself first
- start or attach the PTY only after measured `cols` and `rows` exist
- if a session must start before a viewer exists, record "pending geometry" explicitly instead of silently using fake dimensions

Code sketch:

```ts
interface TerminalBootstrapSize {
  cols: number
  rows: number
  measuredAt: number
}

interface StartTerminalSessionInput {
  taskId: string
  kind: "task" | "shell"
  initialSize: TerminalBootstrapSize
}
```

Short version: the first size should come from xterm fit, not from viewport arithmetic.

## 2. Input semantics are still inconsistent across code paths

The current terminal controller is the right idea:

- `web-ui/src/terminal/use-terminal-session.ts:225`

It distinguishes:

- `terminal.input(text)`
- `terminal.paste(text)`

That is good.

But the higher-level send path still leaks terminal semantics into unrelated app hooks:

- `web-ui/src/hooks/use-task-sessions.ts:152`

Current behavior:

- if a controller exists and `mode === "paste"` and `appendNewline` is `false`, we call `controller.paste(text)`
- otherwise we fall back to `controller.input(...)`
- if no controller exists, we call TRPC, which only supports raw text plus optional newline

Relevant refs:

- `web-ui/src/hooks/use-task-sessions.ts:161`
- `src/trpc/runtime-api.ts:159`
- `src/terminal/session-manager.ts:561`

This means "paste" is not a guaranteed semantic operation. It is a best-effort frontend optimization.

That is still too loose.

Failure cases:

- review comment injection can behave differently depending on whether the terminal surface is mounted
- shortcut-driven multiline content can become line-by-line typed input on fallback paths
- future features will keep re-deciding when to paste versus type

Recommendation:

- define terminal input as a real domain object, not just `text + appendNewline`
- send `mode: "type" | "paste"` through every path, including TRPC fallback
- keep the semantic decision out of board hooks and in a terminal input service

Code sketch:

```ts
interface TerminalInputRequest {
  taskId: string
  text: string
  mode: "type" | "paste"
  appendNewline?: boolean
}
```

If the terminal surface is mounted:

- `type` goes through `terminal.input(...)`
- `paste` goes through `terminal.paste(...)`

If the terminal surface is not mounted:

- the server path still knows the semantic intent and can apply a compatible fallback, or reject unsupported paste delivery clearly

Right now we lose that intent too early.

## 3. Output batching exists, but transport pressure is unmanaged

The websocket bridge batches terminal output every 8ms:

- `src/terminal/ws-server.ts:32`
- `src/terminal/ws-server.ts:121`

That reduces frame spam, but it does not answer:

- what happens when the browser cannot drain fast enough
- what happens when a TUI or agent floods output
- when should we pause PTY reads
- when should we resume them

Our PTY wrapper does not expose pause or resume behavior:

- `src/terminal/pty-session.ts:33`

WebSSH2 explicitly models this with a high water mark and hysteresis:

- `/Users/saoud/Repositories/kanban-idea/webssh2/app/socket/adapters/service-socket-terminal.ts:24`
- `/Users/saoud/Repositories/kanban-idea/webssh2/app/socket/adapters/service-socket-terminal.ts:69`

Recommendation:

- add transport-level backpressure management to the Kanban websocket bridge
- expose PTY flow-control methods in `PtySession`
- pause PTY reads when websocket buffered bytes exceed a high water mark
- resume only after the buffer drops under a lower water mark

Code sketch:

```ts
interface PtyFlowController {
  pauseOutput(): void
  resumeOutput(): void
}

function computeBackpressureAction(
  bufferedBytes: number,
  highWaterMark: number,
  paused: boolean,
): "pause" | "resume" | "none" {
  const lowWaterMark = Math.floor(highWaterMark / 4)
  if (!paused && bufferedBytes >= highWaterMark) return "pause"
  if (paused && bufferedBytes < lowWaterMark) return "resume"
  return "none"
}
```

This matters most for redraw-heavy AI CLIs and full-screen TUIs, where transport softness quickly turns into visible stutter.

## 4. Terminal lifecycle ownership is fragmented

Today:

- xterm instance lifecycle lives in `use-terminal-session.ts`
- session starting decisions live in `use-task-sessions.ts` and `use-terminal-panels.ts`
- fallback input semantics live partly in hooks and partly in runtime API
- PTY defaults and replay behavior live in `session-manager.ts`

Because of that, there is no single answer to questions like:

- when is a terminal considered ready
- when is it allowed to receive app-injected input
- what happens if start happens before attach
- what state is preserved across reconnect
- what behavior is guaranteed after exit

WebSSH2 is not perfect, but its socket terminal adapter is much closer to a single authority on these questions.

Recommendation:

- introduce a small terminal session contract that both the frontend and backend use
- keep app hooks dumb and make them call a terminal-specific orchestration layer

Suggested contract:

```ts
type TerminalConnectionState =
  | { phase: "bootstrapping" }
  | { phase: "connecting"; initialSize: { cols: number; rows: number } }
  | { phase: "attached"; cols: number; rows: number }
  | { phase: "closed"; reason: string | null }
```

The practical value of this is not type beauty. It is making weird race conditions visible instead of accidental.

## 5. History replay exists, but startup state is still underspecified

Kanban does one thing well already: replaying buffered output to late listeners.

Relevant refs:

- `src/terminal/session-manager.ts:174`
- `src/terminal/pty-session.ts:35`

That is useful and should stay.

But replay alone does not solve:

- whether the initial size was correct
- whether the terminal attached before or after the process started
- whether a pasted block was delivered with the same semantics
- whether a reconnect should restore only bytes or also UI state assumptions

Recommendation:

- keep byte history replay
- pair it with explicit session metadata:
  - last known cols
  - last known rows
  - whether the session ever attached to a real terminal
  - maybe a monotonically increasing output sequence number for future debugging

That will make reconnect and delayed attach behavior much easier to reason about.

## 6. Tests still do not cover the behaviors users complain about

We have prior research recorded in `.plan/docs/terminal-emulator-investigation.md`, but the current codebase still lacks focused tests for the important terminal guarantees.

What WebSSH2 does better:

- unit tests for backpressure decisions
- end-to-end tests that check `stty size` and resize behavior

Relevant refs:

- `/Users/saoud/Repositories/kanban-idea/webssh2/tests/unit/stream-backpressure.vitest.ts:171`
- `/Users/saoud/Repositories/kanban-idea/webssh2/tests/playwright/e2e-term-size-replay-v2.spec.ts:151`

Recommended Kanban tests:

1. Startup geometry test
   - mount terminal
   - capture measured fit size
   - start session
   - run `stty size`
   - assert first observed size matches measured size, not `120x40`

2. Resize propagation test
   - resize container
   - assert PTY sees updated rows and cols
   - assert no `0x0` or fixed placeholder values are observed

3. Paste semantics test
   - send multiline input with `mode: "paste"`
   - verify it arrives as paste semantics and does not degrade into separate Enter presses

4. Fallback parity test
   - run the same input action with terminal mounted and with terminal unmounted
   - assert behavior is equivalent or intentionally rejected with a clear error

5. High output pressure test
   - generate rapid output
   - assert websocket buffer control triggers pause and resume without process loss

## What not to copy from WebSSH2

Some parts of WebSSH2 should not be imported into Kanban wholesale:

- its SSH-specific connection and auth layers
- its Socket.IO internals
- its telnet support
- its session-backed remote credential model

Kanban is an embedded local terminal system around `node-pty`, not a general remote SSH gateway.

What we want is the discipline, not the entire architecture.

## Proposed target architecture

```text
Terminal panel
  -> owns xterm instance and measured fit size
  -> reports semantic input events and resize events

Terminal client session layer
  -> starts session only after initial measured size exists
  -> opens IO and control sockets
  -> exposes one input API with mode "type" or "paste"

Terminal websocket bridge
  -> binary IO stream
  -> control messages for resize, stop, state
  -> explicit backpressure control

TerminalSessionManager
  -> spawns node-pty with real initial size
  -> stores replay buffer plus size metadata
  -> handles resize and exit
```

The key change is that startup size and input semantics become explicit parts of the contract, not side effects of whichever hook ran first.

## Recommended implementation order

## Phase 1: Fix startup geometry

This should come first because it affects every task session and shell session, and it is the most visible TUI defect.

Changes:

- remove viewport-estimation-based initial geometry from:
  - `web-ui/src/hooks/use-task-sessions.ts`
  - `web-ui/src/hooks/use-terminal-panels.ts`
- create a measured terminal bootstrap path in `use-terminal-session.ts`
- require real `cols` and `rows` before session start whenever a visible terminal exists
- keep server fallback defaults only for non-visual or headless starts

## Phase 2: Normalize input semantics

Changes:

- replace `text + appendNewline` only input payloads with a semantic input request
- thread `mode: "type" | "paste"` through:
  - `web-ui/src/hooks/use-task-sessions.ts`
  - `src/trpc/runtime-api.ts`
  - `src/terminal/terminal-session-service.ts`
  - `src/terminal/session-manager.ts`
- centralize the mapping from app actions to terminal semantics in one terminal input service

## Phase 3: Add websocket backpressure control

Changes:

- add PTY pause and resume support in `src/terminal/pty-session.ts`
- monitor websocket buffered bytes in `src/terminal/ws-server.ts`
- implement a high water mark and low water mark policy
- add unit tests for pause and resume decisions

## Phase 4: Add terminal-specific tests

Changes:

- add startup geometry and resize tests
- add paste parity tests
- add output-pressure tests

## Concrete refactor targets

If we want to make this codebase feel intentionally designed, these are the seams to change:

1. Replace `estimateTaskSessionGeometry()` with measured bootstrap geometry for visible terminals.
2. Replace `HOME_TERMINAL_ROWS = 16` and approximate shell column math with the same measured bootstrap path.
3. Replace the current `sendTaskSessionInput()` fallback contract with a semantic input payload.
4. Add explicit backpressure handling to `createTerminalWebSocketBridge()`.
5. Extend `PtySession` to support transport-aware flow control.
6. Add tests that verify terminal behavior from the browser down to `stty size`.

## Practical next step

The first implementation pass should not try to fix everything at once.

Best next slice:

1. Introduce a shared `TerminalInputRequest` shape.
2. Introduce a `TerminalBootstrapSize` shape.
3. Rework visible session start so it waits for real fit dimensions.
4. Update task and shell terminals to use the same bootstrap path.
5. Only after that, add backpressure.

That sequence gives us the highest UX win with the least architectural churn.

## Bottom line

The Kanban terminal stack is no longer broken because of one bad choice. It is now mostly limited by missing contracts:

- missing startup geometry contract
- missing input semantics contract
- missing backpressure contract
- missing readiness and reconnect contract

WebSSH2 is useful because it shows what it looks like when those concerns are treated as first-class terminal architecture instead of incidental hook behavior.

That is the standard we should move toward here.
