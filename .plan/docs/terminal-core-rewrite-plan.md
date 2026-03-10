# Terminal Core Rewrite Plan

Date: March 10, 2026

Goal: rebuild the terminal stack around a minimal, boring terminal core so the bottom-pane terminal and the agent terminal both behave like normal integrated terminals, while preserving the Kanban-specific agent workflows on top.

## Problem statement

The current terminal experience still feels more custom and fragile than it should:

- typing and rendering can still feel soft compared to mature xterm integrations
- terminal behavior is split across transport, UI, and agent-specific orchestration layers
- app-driven input paths still have multiple code paths and fallback behavior
- terminal concerns and agent concerns are too interleaved

This makes the system harder to reason about and increases the chance that one surface behaves differently from another.

## Target architecture

The rewrite should leave us with two clearly separated layers.

### Layer 1: terminal core

This layer is the only place that should know how to:

- create an xterm instance
- load official xterm addons
- open a websocket data stream
- attach xterm to that stream
- resize the terminal
- stop the PTY
- surface connection and exit state

On the server side this layer is the only place that should know how to:

- spawn a PTY
- keep PTY dimensions in sync
- stream PTY output to websocket clients
- write websocket input back to the PTY
- stop the PTY

This layer should not know anything about:

- review state transitions
- task-ready-for-review semantics
- auto-review actions
- activity preview heuristics
- agent-specific trust or hook behavior
- Kanban toolbar actions

### Layer 2: agent orchestration

This layer is responsible for:

- choosing which command to run
- deciding cwd and worktree behavior
- session summaries and review transitions
- task-specific hook integration
- agent-specific compatibility logic
- app actions like commit, open PR, add review comments, send review comments

This layer should observe or configure terminal sessions, not reimplement terminal behavior.

## Design principles

1. One terminal IO path
   All live terminal input and output should flow through xterm plus websocket plus PTY. Avoid alternate raw-input APIs for active sessions.

2. One terminal runtime for all surfaces
   The bottom terminal and detail terminal should share the same core runtime hook and server contract.

3. Thin terminal transport, rich app orchestration
   Keep the terminal transport dumb. Put app semantics outside it.

4. Prefer official xterm behavior over custom behavior
   Use official addons and standard xterm APIs unless there is a strong reason not to.

5. Preserve user-visible workflows while reducing custom plumbing
   The refactor should not regress Kanban-specific flows just to make the code smaller.

## Phases

### Phase 1: define and enforce the terminal core boundary

Deliverable:

- a clearly named server-side terminal core API and client-side terminal runtime hook that both surfaces use

Intent:

- identify what belongs to pure terminal runtime versus agent orchestration
- centralize xterm setup and websocket attachment
- make terminal lifecycle code easy to follow

### Phase 2: simplify server-side PTY session handling

Deliverable:

- a PTY-focused server module that is responsible only for process lifecycle, attach, write, resize, and stop

Intent:

- separate PTY management from review and agent state logic as much as practical
- narrow websocket handling to data transport and a small control plane
- remove redundant or overlapping transport behavior

### Phase 3: reconnect app actions through the new terminal core

Deliverable:

- app actions that target active terminals through the shared terminal runtime instead of bespoke input paths

Intent:

- eliminate inconsistent live-session input behavior
- make bottom and detail terminal actions feel identical
- reduce fallback behavior to the minimum required for correctness

### Phase 4: narrow agent-specific logic to a clear orchestration layer

Deliverable:

- session and review state logic that depends on terminal sessions but no longer pollutes the terminal transport layer

Intent:

- keep current Kanban functionality
- make future terminal bugs easier to isolate from agent bugs

### Phase 5: verification and cleanup

Deliverable:

- passing typechecks and tests
- deletion of dead helpers and redundant abstractions
- updated plan and notes with any remaining caveats

Intent:

- finish with a simpler architecture, not just a different one

## Non-goals

- replacing xterm with another terminal library
- dropping support for Kanban task sessions
- removing worktree-aware command launching
- redesigning the agent product flow

## Success criteria

We should consider this rewrite successful when:

- both terminal surfaces use the same core runtime path
- active session input no longer depends on a separate raw fallback path in normal operation
- server transport is easy to describe in a few sentences
- terminal-related bugs can be debugged without first understanding agent review state logic
- the code reads like a standard browser terminal integration instead of a bespoke protocol stack

## Verification checklist

- bottom-pane shell terminal launches, resizes, accepts typing, and stops cleanly
- detail-view shell terminal launches, resizes, accepts typing, and stops cleanly
- task agent terminal still launches the configured agent command
- review comment insertion still works
- git action prompts still work
- session state updates still reach the UI
- typecheck and tests pass

## Expected risky areas

- session summary propagation
- fallback behavior when a terminal surface is not yet mounted
- task session lifecycle interactions with review-state transitions
- agent-specific launch adapters and hook behavior
