# Terminal Emulator Investigation

Date: March 10, 2026

Purpose: preserve the terminal research, upstream issue reading, local code investigation, and the reasoning behind the terminal refactor so future sessions do not lose context.

## User problem statement

The terminal experience in the Kanban web app felt much worse than VS Code:

- laggy typing
- visible flashing and repaint jitter
- poor TUI behavior
- copy and paste not feeling like a real terminal
- multiline text sometimes behaving like Enter instead of paste
- suspicion that the app was doing too much custom plumbing instead of using existing xterm ecosystem pieces

The core question was not only "what should we change?" but "why does this feel so much worse than the normal xterm-based terminals people are used to?"

## Local implementation that was investigated

The initial investigation traced these files:

- `web-ui/src/components/detail-panels/agent-terminal-panel.tsx`
- `src/terminal/ws-server.ts`
- `src/terminal/session-manager.ts`
- `web-ui/src/hooks/use-terminal-panels.ts`
- `web-ui/src/hooks/use-task-sessions.ts`
- `web-ui/src/hooks/use-board-interactions.ts`
- `web-ui/src/hooks/use-git-actions.ts`
- `web-ui/src/runtime/task-session-geometry.ts`
- `src/core/api-contract.ts`

Before the refactor, the terminal stack looked like this:

- xterm on the frontend
- `FitAddon` and `WebLinksAddon` only
- custom websocket path at `/api/terminal/ws`
- terminal input and output sent as JSON messages
- terminal input and output text encoded as base64 inside those JSON messages
- resize and stop sent as additional JSON control messages on the same socket
- review comments and some command injection paths bypassed xterm paste semantics and wrote directly to the PTY through app APIs

## Key local findings before refactor

### 1. The hot path was heavily custom

The browser terminal was using a custom websocket protocol for every output chunk and every input event.

Observed path:

- frontend received terminal output frames as JSON
- output bytes were base64 encoded on the server
- output was JSON stringified on the server
- frontend parsed JSON
- frontend base64 decoded back to text
- frontend called `terminal.write(...)`

This was happening inside the hottest part of the system. That means we were paying extra overhead on:

- JSON serialization
- JSON parsing
- base64 encoding
- base64 decoding
- more websocket frames than necessary

That overhead is exactly where a terminal feels "soft" or "laggy", because terminals are extremely sensitive to per-frame cost.

### 2. We were not using xterm's transport add-on

Xterm ships `@xterm/addon-attach` specifically for attaching a terminal to a websocket data stream.

Before the refactor, we were not using it. We had effectively rebuilt a poorer version of it.

The add-on matters because it already handles:

- data flow from socket to terminal
- data flow from terminal to socket
- `onData`
- `onBinary`
- correct websocket binary behavior

This was one of the clearest signals that the app had drifted into unnecessary custom plumbing.

### 3. We were not using `onBinary`

Xterm's typings explicitly note that `onBinary` exists for non UTF-8 conformant binary messages, currently used for certain mouse reports.

That means a terminal embedder that only forwards `onData` is incomplete for some terminal use cases, especially TUIs with mouse interaction.

The old code listened to `onData` only and ignored `onBinary`.

Conclusion: some TUI behavior could never match a fuller terminal implementation.

### 4. We were not using better renderer options

The old frontend used base xterm with no WebGL renderer.

That meant:

- no GPU-accelerated rendering path
- no renderer fallback logic beyond default xterm behavior
- higher chance of visible repaint cost under heavy TUI output

VS Code spends a lot of effort ensuring the faster renderer path is active when possible. We were not.

### 5. We were not using clipboard support add-ons or proper embedder glue

Copy and paste in xterm is not "automatically solved" by xterm itself. Xterm maintainers are explicit that copy/paste shortcuts and browser integration are largely the embedder's responsibility.

We had very little clipboard-specific glue in the terminal panel.

Result:

- shortcut behavior was incomplete
- platform parity was incomplete
- the terminal did not feel like a native integrated terminal

### 6. Programmatic "send to terminal" paths bypassed paste semantics

This was one of the most important functional findings.

Several app flows injected text into task sessions without going through xterm's own paste handling:

- review comments
- some git action prompts
- shortcut command injection
- home/detail terminal "run agent command" actions

That matters because xterm's `paste()` method does transformations that are different from "type these raw characters".

When multiline content is sent as raw PTY input instead of as terminal paste, line breaks can behave like Enter presses. That matched the user complaint.

This meant the app had two different categories of input:

- real terminal input from the xterm surface
- app-injected text that bypassed terminal semantics

Those two paths behaved differently, which made the UX feel inconsistent and broken.

### 7. Shell terminals started with fake geometry

The shell terminals at the bottom panel and detail panel were started with a fixed row count and no real column count, then resized later.

This created a "wrong size first, then correct size later" startup sequence.

That is especially bad for TUIs, because a full-screen app can:

- layout itself once at the wrong size
- immediately receive a resize
- repaint and jump visually

That contributes to the "jerking around" feeling.

### 8. The old terminal panel touched xterm private internals

The panel used an internal `_core.viewport.scrollBarWidth` escape hatch to zero out scrollbar reserve.

That is brittle for two reasons:

- it depends on internals, not a stable public API
- it is a layout hack in one of the most sensitive components

Any time terminal fit and viewport logic are manipulated with internal fields, the chance of resize weirdness and future regressions goes up.

### 9. Resize behavior was too eager

The old `ResizeObserver` called fit and resize propagation immediately on every observed change.

During layout churn this can produce:

- a lot of `fit()` calls
- a lot of PTY resize calls
- extra redraw work

This is not the only cause of lag, but it amplifies it.

### 10. AI CLI tools themselves can be pathological

One important nuance from upstream issue reading:

- some AI CLIs clear and redraw aggressively
- some appear to clear scrollback or repaint the whole screen repeatedly
- that can make any terminal look worse if the renderer and output synchronization are not strong

So not every symptom was caused by our code alone. But our code made the behavior much worse than it needed to be.

## Upstream research and issue reading

The investigation included xterm and VS Code issue reading. The most important findings are captured below.

### xterm README

Source:

- https://github.com/xtermjs/xterm.js

Key takeaways:

- xterm is used by VS Code, Hyper, Theia
- xterm has a GPU-accelerated renderer
- xterm ships official add-ons for attach, clipboard, fit, web links, WebGL, etc.
- the ecosystem already contains the pieces we needed

This reinforced the conclusion that our app was doing too much custom work in areas already covered by xterm's add-ons.

### xterm issue 2478: Browser Copy/Paste support documentation

Source:

- https://github.com/xtermjs/xterm.js/issues/2478

Important maintainer guidance from that thread:

- xterm does not do anything special with copy and paste by default
- copy/paste shortcuts are largely left to embedders
- embedders should wire shortcut behavior using custom key handling and browser clipboard events

Why this mattered:

- it explained why our terminal did not magically behave like VS Code by default
- it confirmed that missing clipboard glue in our app was a real bug, not just user preference

### xterm issue 1122: Support bracketed paste mode

Source:

- https://github.com/xtermjs/xterm.js/issues/1122

Takeaway:

- xterm supports bracketed paste mode
- bracketed paste exists specifically because pasted text should not always behave like individual keypresses

Why this mattered:

- it directly connected to the user's complaint about multiline text and Enter behavior
- it supported the conclusion that programmatic injection should use terminal paste semantics when the user intent is "paste this block"

### xterm issue 5620: Scrollbar abnormal jumping, page shaking, flicker with AI CLI tools

Source:

- https://github.com/xtermjs/xterm.js/issues/5620

Important points from that thread:

- maintainers discussed AI tools whose redraw style causes visible shaking and scrollbar weirdness
- synchronized output support was cited as part of the fix story
- maintainers also noted that some tools may be using the terminal in a way that is not ideal

Why this mattered:

- it showed that the "AI terminal looks jittery" problem is real and recognized upstream
- it also explained that app-side plumbing still matters, because poor transport and rendering amplify redraw-heavy tools

### xterm PR 5453: Add synchronized output support

Source:

- https://github.com/xtermjs/xterm.js/pull/5453

Merged date:

- December 20, 2025

Takeaway:

- xterm added synchronized output mode support
- this was specifically about deferring rendering and flushing updates atomically
- the motivation was reducing tearing during rapid output

Why this mattered:

- it established that the xterm project itself has been actively improving exactly the kind of tearing/flashing behavior the user complained about
- it also suggested that staying current on xterm versions matters

### xterm issue 5320: Fit addon weird resize behavior

Source:

- https://github.com/xtermjs/xterm.js/issues/5320

Takeaway:

- fit-related weirdness exists in the ecosystem
- repeated resize and container layout edge cases can go wrong
- some container and overflow details matter a lot

Why this mattered:

- it reinforced that resize handling should be conservative and well-behaved
- it made the old private viewport hack look even less trustworthy

### VS Code issue 140128: New integrated terminals are never GPU accelerated

Source:

- https://github.com/microsoft/vscode/issues/140128

Important guidance from the thread:

- VS Code logs when WebGL loads or falls back
- they explicitly verify whether the WebGL renderer is active

Why this mattered:

- it showed how seriously VS Code treats renderer selection
- it validated the intuition that a "real" integrated terminal experience depends on renderer-path quality, not just xterm existing somewhere in the stack

### VS Code issue 159476: Integrated terminal slow to render output

Source:

- https://github.com/microsoft/vscode/issues/159476

Important point from the report:

- rendering performance alone can materially slow real workloads when the terminal is visible

Why this mattered:

- it showed that terminal rendering overhead is not cosmetic
- it can directly affect perceived responsiveness and throughput
- it further supported focusing on the rendering and transport hot path

## Why VS Code felt better than the old Kanban terminal

The main conclusion from the research was:

VS Code is not "just xterm".

VS Code is xterm plus:

- better renderer selection
- GPU acceleration management
- terminal-specific clipboard and keybinding glue
- more mature transport behavior
- more handling around resize, fallback, and terminal lifecycle
- years of terminal-specific fixes that reduce papercuts

By contrast, the old Kanban stack was:

- xterm in a slower baseline configuration
- custom transport on the hottest path
- incomplete input forwarding
- incomplete clipboard behavior
- inconsistent app-injected input semantics
- poor startup geometry

So the user's intuition was correct. It was not that "browser terminals are bad". It was that our particular browser-terminal stack had several avoidable self-inflicted problems.

## Root cause summary before the refactor

Highest-confidence causes:

- custom JSON plus base64 transport on the terminal hot path
- no `@xterm/addon-attach`
- no `onBinary` transport support
- no WebGL renderer path
- incomplete clipboard integration
- multiline app injection bypassing xterm paste semantics
- shell terminal startup with incorrect geometry

Medium-confidence amplifiers:

- eager resize behavior
- private xterm viewport hack
- AI CLIs that repaint aggressively

## Refactor direction that came out of the research

The refactor direction chosen from this investigation was:

- stop treating terminal IO and terminal control as one custom protocol
- use raw websocket terminal IO for the actual xterm data stream
- use xterm's `AttachAddon` for the IO path
- keep a small JSON control socket only for:
  - state updates
  - exit notifications
  - resize requests
  - stop requests
- add xterm clipboard support
- add WebGL renderer support
- add Unicode 11 support
- debounce resize
- stop relying on private viewport internals
- route app-injected multiline text through xterm `paste()` when the intent is paste
- start shell PTYs with a better initial column estimate

This direction was chosen because it removed custom plumbing in the most latency-sensitive area while preserving the Kanban-specific session state model that xterm add-ons do not know about.

## What was changed in the implementation after the research

These are the important changes made after the investigation:

- terminal IO websocket split from control websocket
- raw binary/string data used for terminal IO instead of base64-in-JSON
- `@xterm/addon-attach` added for frontend terminal IO
- `@xterm/addon-clipboard` added
- `@xterm/addon-webgl` added
- `@xterm/addon-unicode11` added
- xterm upgraded to v6
- resize debouncing added
- app-injected terminal text now prefers live terminal controller paths
- multiline review-comment and git-action prompt insertion can use `paste()` semantics
- shell sessions now start with an estimated column count instead of waiting to resize from a fake size

Files touched in the refactor:

- `src/server/runtime-server.ts`
- `src/terminal/ws-server.ts`
- `src/core/api-contract.ts`
- `web-ui/package.json`
- `web-ui/package-lock.json`
- `web-ui/src/components/detail-panels/agent-terminal-panel.tsx`
- `web-ui/src/hooks/use-task-sessions.ts`
- `web-ui/src/hooks/use-terminal-panels.ts`
- `web-ui/src/hooks/use-board-interactions.ts`
- `web-ui/src/hooks/use-git-actions.ts`
- `web-ui/src/hooks/use-shortcut-actions.ts`
- `web-ui/src/terminal/terminal-controller-registry.ts`

## Things that were deliberately kept custom

Not all custom logic should be removed.

These areas are still app-specific and worth keeping custom:

- Kanban task session state
- task session summaries
- review-state transitions
- stop semantics
- toolbar actions like Commit and Open PR
- worktree-aware shell session creation

The research conclusion was not "delete all custom code". It was "delete the custom code in the wrong places".

The wrong places were:

- raw terminal transport
- paste behavior
- renderer path setup
- clipboard behavior

## Remaining caveats and follow-up ideas

Even after the refactor, a few caveats remain worth remembering:

- AI CLIs that aggressively repaint can still look rougher than classic line-oriented tools
- synchronized output support from newer xterm work may be worth revisiting later
- Linux shortcut parity and context-menu behavior can still be improved further
- if TUI mouse behavior still feels incomplete in some scenarios, verify all binary event paths end-to-end
- renderer fallback visibility and diagnostics could still be improved

## Practical takeaways for future sessions

If the terminal starts feeling bad again, check these first:

- are we still using `AttachAddon` for the IO path?
- did any code path reintroduce JSON plus base64 terminal traffic?
- are app-injected multiline inputs using `paste()` when they should?
- is WebGL actually loading?
- did anyone reintroduce internal xterm viewport hacks?
- are shell sessions starting with wrong geometry again?
- are there any new input paths that bypass the live terminal controller?

## Source links

Upstream sources used in the investigation:

- xterm README: https://github.com/xtermjs/xterm.js
- xterm issue 2478: https://github.com/xtermjs/xterm.js/issues/2478
- xterm issue 1122: https://github.com/xtermjs/xterm.js/issues/1122
- xterm issue 5620: https://github.com/xtermjs/xterm.js/issues/5620
- xterm PR 5453: https://github.com/xtermjs/xterm.js/pull/5453
- xterm issue 5320: https://github.com/xtermjs/xterm.js/issues/5320
- VS Code issue 140128: https://github.com/microsoft/vscode/issues/140128
- VS Code issue 159476: https://github.com/microsoft/vscode/issues/159476
