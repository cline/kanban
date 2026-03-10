# Terminal Node-Pty Gap Closure Plan

Date: March 10, 2026

Goal: reduce the distance between the Kanban browser terminal path and the minimal `xterm <-> transport <-> node-pty` loop shown by the official `node-pty` Electron example.

## Why this plan exists

The official `node-pty` Electron example is tiny:

- xterm sends input
- node-pty writes input to the PTY
- node-pty emits output
- xterm renders output
- resize flows through directly

That loop is short and predictable. Our terminal stack is closer than it used to be, but there is still extra work around terminal output and session summaries that increases latency and complexity.

## Progress checkpoint

Completed:

- activity preview extraction has been removed end to end
- PTY output now uses `node-pty` raw-byte mode with `encoding: null`
- browser terminal IO is still binary, and `@xterm/addon-attach` already sets `binaryType = "arraybuffer"`
- input forwarding now stays byte-native except where agent-specific state detection genuinely needs inspection
- the 2-second workspace-retrieve heartbeat no longer flows through the main client runtime-state reducer
- Claude trust handling no longer uses a polling loop; it reacts directly to PTY output chunks

Still remaining:

- `session-manager.ts` still decodes some task-session output for `detectOutputTransition`
- Claude trust prompt detection still watches decoded output for specific text
- manual in-app feel still needs to be rechecked after these hot-path cuts

## Main remaining gaps

### 1. Per-output app logic still exists in the session manager

Even after transport cleanup, session-manager still inspects output for agent transitions and updates summary state on output activity.

Plan:

- trim any remaining output-path work that is not strictly needed for terminal transport correctness
- keep only the minimum session semantics required for Kanban behavior
- move optional or derived behavior away from the core terminal loop whenever possible

### 4. Startup geometry must stay real

Visible terminals should continue to prefer real fitted geometry over guessed dimensions before spawning shells or agents.

Plan:

- keep using live geometry from mounted terminal surfaces
- avoid regressing to estimate-only startup for visible sessions
- add tests if needed once the main hot-path cleanup settles

## Working order

1. Measure the in-app feel after the completed preview-removal and raw-byte transport changes.
2. Trim any remaining output-path app work that still sits inside the terminal loop.
3. Add runtime diagnostics if manual testing suggests the renderer or transport is still not behaving as expected.

## Success criteria

- terminal output path is closer to raw PTY bytes and websocket frames
- session manager is simpler and easier to describe
- measured terminal feel is improved after hot-path cleanup
