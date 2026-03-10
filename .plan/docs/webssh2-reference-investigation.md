# WebSSH2 Reference Investigation

Date: March 10, 2026

Purpose: capture the useful architectural and implementation lessons from `billchurch/webssh2` so we can compare them against Kanban's current xterm and PTY stack in a grounded way.

## Scope

This investigation covered:

- `~/Repositories/kanban-idea/webssh2`
- the packaged browser client shipped through the `webssh2_client` dependency
- selected source files from `billchurch/webssh2_client` on GitHub, because the browser xterm implementation is not fully in the server repo

Important caveat:

- WebSSH2 is not a `node-pty` app. It is a web client and server that proxies an SSH shell stream from `ssh2` into xterm in the browser.
- That means some lessons transfer directly to Kanban, especially transport, resize, clipboard, and event flow.
- Some lessons do not transfer directly, especially anything that depends on SSH auth, host key verification, or remote-shell-specific services.

## High level take

WebSSH2 is much more intentional than our current terminal stack in three places:

1. It treats terminal transport as a first-class system, not incidental glue.
2. It treats terminal geometry as part of authentication and session setup, not just a later resize detail.
3. It separates responsibilities clearly:
   - client xterm setup
   - socket transport
   - auth and session state
   - terminal metadata
   - SSH shell stream lifecycle

The repo is not especially minimal anymore. It has grown into a fairly full product with SFTP, host-key prompts, prompt UI, structured logging, auth flows, and telnet support. But the terminal path itself still has a clean shape that is very useful for us.

## Most relevant files

### Server repo

- `~/Repositories/kanban-idea/webssh2/app/app.ts`
- `~/Repositories/kanban-idea/webssh2/app/io.ts`
- `~/Repositories/kanban-idea/webssh2/app/socket-v2.ts`
- `~/Repositories/kanban-idea/webssh2/app/socket/adapters/service-socket-adapter.ts`
- `~/Repositories/kanban-idea/webssh2/app/socket/adapters/service-socket-authentication.ts`
- `~/Repositories/kanban-idea/webssh2/app/socket/adapters/service-socket-terminal.ts`
- `~/Repositories/kanban-idea/webssh2/app/socket/adapters/service-socket-control.ts`
- `~/Repositories/kanban-idea/webssh2/app/socket/adapters/ssh-config.ts`
- `~/Repositories/kanban-idea/webssh2/app/services/ssh/ssh-service.ts`
- `~/Repositories/kanban-idea/webssh2/app/services/terminal/terminal-service.ts`
- `~/Repositories/kanban-idea/webssh2/app/routes/handlers/ssh-config-handler.ts`
- `~/Repositories/kanban-idea/webssh2/tests/unit/stream-backpressure.vitest.ts`
- `~/Repositories/kanban-idea/webssh2/tests/playwright/e2e-term-size-replay-v2.spec.ts`
- `~/Repositories/kanban-idea/webssh2/CHANGELOG.md`

### Browser client sources

- https://github.com/billchurch/webssh2_client/blob/main/client/src/components/Terminal.tsx
- https://github.com/billchurch/webssh2_client/blob/main/client/src/services/socket.ts
- https://github.com/billchurch/webssh2_client/blob/main/client/src/app.tsx
- `~/Repositories/kanban-idea/webssh2/node_modules/webssh2_client/client/public/webssh2.bundle.js`
- `~/Repositories/kanban-idea/webssh2/node_modules/webssh2_client/client/public/client.htm`

## Architecture in one paragraph

The Express app serves a static browser bundle under `/ssh/assets` and mounts the app under `/ssh`. Socket.IO is configured on `/ssh/socket.io`. When a browser connects, `ServiceSocketAdapter` wires auth, terminal, control, prompt, and SFTP handlers around a shared adapter state object. Authentication stores the initial terminal settings early, opens the SSH connection, emits permissions and a `getTerminal` request, then the browser sends terminal dimensions and opens the xterm-driven session. Once the shell stream exists, server output is emitted as binary `data` events to the client, and client keystrokes are emitted as `data` events back to the server.

## End to end flow

### 1. Server startup

`app/app.ts` initializes config, DI services, Express routes, and Socket.IO:

```ts
const { app, sessionMiddleware } = createAppAsync(appConfig)
const server = createServer(app)
const io = configureSocketIO(server, sessionMiddleware, cfgForIO)
initSocket(io, appConfig, services, 'ssh')
```

Useful details:

- the client UI is treated like a packaged artifact, not app code mixed into the server
- Socket.IO setup is centralized in `app/io.ts`
- the socket layer receives a typed `services` object instead of importing everything ad hoc

### 2. Browser loads packaged client

The HTML shell in `webssh2_client/client/public/client.htm` is very thin:

```html
<script type="module" crossorigin src="./webssh2.bundle.js"></script>
<link rel="stylesheet" crossorigin href="./webssh2.css">
```

And the server resolves the client asset directory through the dependency package:

```ts
import webssh2Client from 'webssh2_client'

export function getClientPublicPath(): string {
  const client = webssh2Client as { getPublicPath: () => string }
  return client.getPublicPath()
}
```

Why this matters for us:

- they have a real boundary between terminal UI and server runtime
- the server repo can evolve independently from the xterm UI package
- that separation probably reduced the temptation to keep jamming one-off browser hacks into server code

### 3. Socket connection and handler composition

`app/socket-v2.ts` is deliberately tiny:

```ts
io.on('connection', (socket) => {
  const serviceAdapter = new ServiceSocketAdapter(socket, config, services, protocol)
  void serviceAdapter
})
```

The real composition happens inside `ServiceSocketAdapter`:

```ts
this.prompt = new ServiceSocketPrompt(this.context)
this.auth = new ServiceSocketAuthentication(this.context, this.prompt)
this.terminal = new ServiceSocketTerminal(this.context)
this.control = new ServiceSocketControl(this.context)
this.sftp = new ServiceSocketSftp(this.context)
```

This is one of the healthiest patterns in the codebase. It avoids a giant websocket god-object.

### 4. Auth stores terminal geometry before the shell exists

This was one of the most relevant findings for Kanban.

In `service-socket-authentication.ts`, WebSSH2 stores initial terminal settings during auth:

```ts
private storeTerminalSettings(credentials: AuthCredentials): void {
  const { initialTermSettings } = this.context.state

  if (credentials.term !== undefined) {
    initialTermSettings.term = credentials.term
  }

  if (credentials.rows !== undefined) {
    initialTermSettings.rows = credentials.rows
  }

  if (credentials.cols !== undefined) {
    initialTermSettings.cols = credentials.cols
  }
}
```

Then `buildTerminalDefaults` in `ssh-config.ts` reuses those stored values when the shell is finally opened:

```ts
return {
  term: settings?.term ?? initialTermSettings.term ?? TERMINAL_DEFAULTS.DEFAULT_TERM,
  rows: settings?.rows ?? initialTermSettings.rows ?? TERMINAL_DEFAULTS.DEFAULT_ROWS,
  cols: settings?.cols ?? initialTermSettings.cols ?? TERMINAL_DEFAULTS.DEFAULT_COLS,
  env: envVars
}
```

This is exactly the kind of detail our current stack has been weak on.

Lesson:

- the first shell spawn should use the best available real geometry
- resize is not just corrective maintenance after startup
- if the shell launches with fake geometry, TUI apps pay the cost immediately

### 5. Auth success explicitly requests terminal creation

After auth succeeds, WebSSH2 emits a few structured events:

```ts
socket.emit(SOCKET_EVENTS.AUTHENTICATION, {
  action: 'auth_result',
  success: true
})

socket.emit(SOCKET_EVENTS.PERMISSIONS, { ... })
socket.emit(SOCKET_EVENTS.GET_TERMINAL, true)
socket.emit(SOCKET_EVENTS.UPDATE_UI, { element: 'status', value: 'Connected' })
```

That `getTerminal` event is important. It means terminal setup is coordinated, not assumed.

On the client side in `client/src/services/socket.ts`:

```ts
socketInstance.on('getTerminal', () => this.getTerminal())
```

And `getTerminal()` sends the latest measured dimensions:

```ts
private getTerminal(): void {
  const dims = terminalDimensions()
  const terminal = { cols: dims.cols ?? 0, rows: dims.rows ?? 0 }
  currentSocket.emit('terminal', terminal)
}
```

This is a better handshake than "open shell immediately and hope the frontend resizes soon."

## Browser xterm implementation

### What the browser client actually does

The real xterm setup lives in `webssh2_client`'s `Terminal.tsx`.

The browser component:

- instantiates xterm through a Solid wrapper
- loads `FitAddon`
- loads `SearchAddon`
- wires `onData` to the socket service
- installs a custom clipboard integration layer
- fits on mount
- observes container resize and window resize
- exposes a terminal action interface for the rest of the app

### The core setup

```ts
const fitAddonInstance = new FitAddon()
setFitAddon(fitAddonInstance)
terminal.loadAddon(fitAddonInstance)

const searchAddonInstance = new SearchAddon()
setSearchAddon(searchAddonInstance)
terminal.loadAddon(searchAddonInstance)

const clipboardInstance = new TerminalClipboardIntegration(clipboardSettings)
clipboardInstance.attach(terminal)
```

Compared to our current code, a few things stand out:

- they use a dedicated clipboard integration abstraction instead of sprinkling clipboard behavior directly through the panel and terminal hook
- they expose a `TerminalActions` surface so the rest of the app is not constantly reaching through refs
- they keep terminal features like search and clipboard close to the terminal component

### Their terminal options are user-settings driven

```ts
const mergedOptions: Partial<ITerminalOptions> = {
  cursorBlink: ...,
  scrollback: validateNumber(..., 1, 200000, ...),
  tabStopWidth: validateNumber(...),
  fontSize: validateNumber(...),
  fontFamily: String(...),
  letterSpacing: ...,
  lineHeight: ...,
  allowProposedApi: true
}
```

This is less about the exact settings and more about the discipline:

- validate settings at the boundary
- keep option merging centralized
- keep xterm options as terminal concerns, not random app concerns

### Resize behavior

Their resize behavior is conceptually good, but not perfect.

Good:

- `FitAddon` is the single source of truth for actual cols/rows
- measured dimensions are stored in a reactive signal
- a debounced emitter sends resize events to the server

Client side:

```ts
const dims = {
  cols: currentRef.terminal.cols,
  rows: currentRef.terminal.rows
}

if (
  dims.cols !== currentDims.cols ||
  dims.rows !== currentDims.rows
) {
  setTerminalDimensions(dims)
}
```

Socket service:

```ts
private debouncedEmitResize = createDebouncedResizeEmitter(
  (dimensions) => {
    currentSocket.emit('resize', dimensions)
  },
  RESIZE_DEBOUNCE_DELAY
)
```

Less good:

- their `ResizeObserver` callback just calls `fitTerminal()` directly
- the component appears to rely on a single post-fit reactive path to debounce server communication, rather than debouncing the fit work itself

So I would not cargo-cult their exact resize mechanics. But the overall architecture is still healthier than ours.

### Clipboard handling is more intentional than ours

WebSSH2 does not rely on xterm defaults. It adds a dedicated clipboard integration layer and exposes explicit actions:

```ts
clipboard: {
  copy: async () => { ... },
  paste: async () => {
    const text = await manager.readText()
    if (text) {
      term.paste(text)
    }
  },
  updateSettings: (settings) => { ... }
}
```

This reinforces an important point for Kanban:

- "paste this block into the terminal" should go through terminal paste semantics
- it should not bypass xterm and write raw input to the process unless that is specifically desired

That aligns strongly with the problems we already documented in our own investigation.

## Socket and transport design

### They use one logical socket with typed events

Unlike our current two-websocket design, WebSSH2 uses one Socket.IO connection with typed named events:

- `authenticate`
- `terminal`
- `resize`
- `data`
- `control`
- `permissions`
- `getTerminal`
- `ssherror`
- `connection-error`

The event constants live in `app/constants/socket-events.ts`.

This has pros and cons.

Pros:

- easier lifecycle coordination
- fewer connection states to reconcile
- one place to observe disconnection and cleanup

Cons:

- less explicit separation between data plane and control plane
- you depend on Socket.IO framing and event semantics
- the transport is less bare-metal than raw websocket attach

I do not think we should copy the one-socket design blindly. But I do think we should notice that their single-socket flow is cleaner than our current "custom dual websocket protocol plus app-specific control logic everywhere."

### They send terminal output as binary chunks

This is one of the strongest transport takeaways.

On the server:

```ts
stream.on('data', (chunk: Buffer) => {
  this.context.socket.emit(SOCKET_EVENTS.SSH_DATA, chunk)
})
```

On the client:

```ts
socketInstance.on('data', (chunk: string | ArrayBuffer) => {
  if (chunk instanceof ArrayBuffer) {
    const bytes = new Uint8Array(chunk)
    writeToTerminal(bytes)
  } else {
    writeToTerminal(chunk)
  }
})
```

This is much closer to how a terminal transport should behave than JSON-wrapping every output payload.

Relevant changelog note:

- `CHANGELOG.md` for `4.0.1` explicitly mentions "binary WebSocket transport and backpressure fix"

That lines up with the code and with the exact class of problems we have been feeling in Kanban.

### They handle output backpressure explicitly

This was one of the best technical findings in the repo.

In `service-socket-terminal.ts`, they inspect the Engine.IO websocket's `bufferedAmount` and pause the SSH stream when the outgoing websocket buffer grows too large.

Core helpers:

```ts
export function getWebSocketBufferedBytes(socket): number | null { ... }

export function computeBackpressureAction(
  bufferedBytes: number | null,
  highWaterMark: number,
  currentlyPaused: boolean
): 'pause' | 'resume' | 'none' { ... }
```

And in the stream flow:

```ts
if (action === 'pause') {
  backpressure.paused = true
  stream.pause()
  scheduleResumeCheck()
}
```

Then later:

```ts
if (action === 'resume') {
  backpressure.paused = false
  stream.resume()
}
```

This is excellent terminal plumbing.

Why it matters for Kanban:

- terminals are bursty
- AI tools and TUIs can emit a lot of output very quickly
- if the browser or websocket cannot keep up, unbounded firehose behavior makes everything worse
- backpressure is not just a server scaling concern here, it is a user experience concern

We should seriously consider a comparable idea in our stack, especially around hot output paths.

### They also support output rate limiting

There is also an optional bytes-per-second rate limit:

```ts
const rateLimitBytesPerSec = this.context.config.ssh.outputRateLimitBytesPerSec ?? 0
```

This is probably less important for Kanban than the backpressure logic, but it is a useful indicator of maturity: they thought about stream abuse and output floods as real problems.

## Server side abstractions

### Terminal service is metadata, not emulation

Their `TerminalServiceImpl` is not a PTY or renderer. It is a registry of terminal metadata:

```ts
const terminal: Terminal = {
  id: `term-${options.sessionId}`,
  sessionId: options.sessionId,
  term: options.term ?? this.defaultTerm,
  rows: options.rows ?? this.defaultRows,
  cols: options.cols ?? this.defaultCols,
  env: options.env ?? {}
}
```

It tracks:

- term type
- rows
- cols
- env
- store updates

But it does not own the shell stream. The SSH service owns the connection and the shell stream.

That separation is conceptually useful for Kanban too:

- a "terminal session registry" and a "transported process stream" are related, but not the same thing
- our current `TerminalSessionManager` mixes a lot of concerns together

I do not think we should copy their exact service split one to one, but the direction is good.

### Shared adapter state is small and explicit

Their adapter context stores only a small set of mutable cross-handler fields:

```ts
export interface AdapterSharedState {
  sessionId: SessionId | null
  connectionId: string | null
  shellStream: SSH2Stream | null
  storedPassword: string | null
  initialTermSettings: { term?: string; rows?: number; cols?: number }
  ...
}
```

That is much easier to reason about than hidden mutations across unrelated modules.

## Auth and prompt flow

This part is SSH-specific, but still worth noting because the shape is good.

WebSSH2:

- can request basic credentials
- can request keyboard-interactive prompts
- uses a prompt abstraction instead of special-casing every auth UI
- emits structured connection error payloads for richer client-side UX

Example:

```ts
this.promptAdapter.sendInputPrompt(
  {
    title: 'SSH Authentication',
    message: 'Please provide your credentials',
    inputs,
    submitLabel: 'Connect',
    cancelLabel: 'Cancel',
    icon: 'Lock',
    severity: 'info'
  },
  async (response) => { ... }
)
```

For Kanban, the direct transfer is not "copy this auth system." The useful lesson is:

- use a narrow prompt abstraction for interactive terminal-adjacent flows
- do not smear prompt logic across transport, UI, and session orchestration code

## Testing posture

This repo is stronger than I expected on tests for the terminal path.

Particularly useful:

- `tests/unit/stream-backpressure.vitest.ts`
- `tests/playwright/e2e-term-size-replay-v2.spec.ts`

Those tests prove they care about:

- backpressure behavior
- terminal size actually reaching the shell
- resize changing shell geometry
- credential replay behavior

This is relevant because our current terminal work has not had enough tests around the exact things that break terminal UX.

## Things I would steal for Kanban

### 1. Binary output transport as the default hot path

This is the most obvious one.

WebSSH2's output path is fundamentally:

- shell stream chunk
- binary socket emit
- browser receives `ArrayBuffer`
- xterm writes bytes

That is the right spirit for terminal output.

### 2. Real handshake around initial terminal geometry

They explicitly preserve and replay terminal dimensions during auth and shell creation. We need the same mindset around our session start path.

### 3. A narrower terminal feature boundary

Terminal-specific features live with the terminal:

- fit
- search
- clipboard
- terminal actions

That is healthier than having app-level hooks invent their own input semantics.

### 4. Backpressure awareness

Even if we do not use the same implementation, the concept should transfer:

- terminal streams should not be treated as infinitely flushable
- large browser output buffers should be able to slow the producer

### 5. Typed event contracts

The event names and payloads are centralized and typed. That keeps the terminal protocol from decaying into undocumented folklore.

### 6. Stronger testing around terminal behavior

We need tests for:

- initial cols/rows used at process start
- resize propagation
- multiline paste behavior
- reconnect or replay behavior if we support it
- output buffering behavior under large bursts

## Things I would not steal for Kanban

### 1. Socket.IO as a drop-in choice

WebSSH2's use of Socket.IO is coherent, but I do not think that means we should switch.

We already moved closer to xterm-native raw websocket attach semantics. That is probably still the right direction for us.

### 2. Their exact resize observer behavior

They call fit directly from `ResizeObserver` and rely on downstream debouncing for socket emission. I would prefer stronger debouncing around the expensive fit path itself.

### 3. Their browser client packaging split as an immediate refactor target

The packaged client boundary is interesting, but that is not the first problem we need to solve. Transport correctness and terminal semantics matter more right now.

### 4. SSH-specific abstractions

Host-key verification, auth policies, keyboard-interactive flow, SFTP, and connection error taxonomies are useful examples of structure, but not directly reusable in our local `node-pty` terminal runtime.

## Comparison against Kanban

Our current relevant files:

- `web-ui/src/terminal/use-agent-terminal.ts`
- `web-ui/src/components/detail-panels/agent-terminal-panel.tsx`
- `src/terminal/ws-server.ts`
- `src/terminal/session-manager.ts`
- `.plan/docs/terminal-emulator-investigation.md`

### Areas where WebSSH2 is stronger

1. Output transport discipline
   - binary chunks instead of custom JSON payloads on the hot path
   - explicit backpressure handling

2. Terminal lifecycle clarity
   - auth and terminal setup have an explicit handshake
   - initial geometry is treated as important state

3. Feature ownership
   - clipboard and search are terminal features, not scattered app actions

4. Test coverage
   - terminal size and transport behavior are tested directly

### Areas where Kanban is already pointed in a good direction

1. We already moved toward xterm's `AttachAddon`
2. We already separated IO and control at the websocket level
3. We already recognized that programmatic input must respect terminal semantics

So this is not a story of "they are right and we are wrong." It is more:

- they confirm several of the concerns we already identified
- they show more deliberate handling of the exact low-level details that make terminal UX feel solid

## Concrete ideas to explore next in Kanban

These are not final recommendations yet. They are the strongest candidates for the follow-up pass.

1. Audit our startup geometry path again
   - make sure the PTY uses the best available measured cols/rows at spawn time
   - avoid launching with placeholders when real dimensions can be known first

2. Tighten terminal feature ownership
   - keep paste, clipboard, and search semantics inside the terminal layer
   - reduce app-level direct writes to the PTY

3. Consider output backpressure or batching improvements
   - we already batch some output in `src/terminal/ws-server.ts`
   - we should evaluate whether browser-side or websocket buffered backpressure should influence the producer

4. Expand tests around terminal transport and geometry
   - startup size
   - resize propagation
   - multiline paste
   - heavy output bursts

5. Review whether our control plane can be simpler
   - our split IO and control sockets are defensible
   - but the surrounding lifecycle code may still be more complex than it needs to be

## Bottom line

WebSSH2 is not a direct blueprint for Kanban because it is an SSH gateway, not a `node-pty` app. But it is still an excellent reference for terminal transport and lifecycle discipline.

The biggest lessons are:

- send terminal output like terminal output, not like app JSON
- treat terminal geometry as session state from the start
- keep terminal semantics inside the terminal layer
- handle pressure on the output path explicitly
- test the terminal behavior that users actually feel

Those are exactly the places where our current implementation has felt improvised.
