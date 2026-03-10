# Notes

- User wants the full rewrite done end to end, not a narrow fix for paste behavior.
- The desired architecture is a boring terminal core with agent behavior layered on top.
- The existing terminal research doc is `.plan/docs/terminal-emulator-investigation.md`.
- Implemented a reusable PTY session core in `src/terminal/pty-session.ts` to own spawn, output history, write, resize, and stop behavior.
- Introduced `src/terminal/terminal-session-service.ts` so the websocket bridge depends on a small transport contract instead of the entire session manager.
- The client runtime hook was renamed to `web-ui/src/terminal/use-terminal-session.ts` to make the shared terminal-session boundary explicit.
- `TerminalSessionManager` still owns task-summary and review-transition logic by design. The main change in this pass was moving raw PTY lifecycle concerns out of it.
- `use-task-sessions.ts` still keeps a server-side input fallback for cases where no live terminal controller exists. That is now a deliberate background-session escape hatch, not the primary path for visible terminals.
- WebSSH2 reference repo confirmed two relevant architecture gaps still worth addressing after the initial refactor:
  startup geometry should be real before shell spawn, and transport should apply backpressure when websocket buffering grows.
- Implemented websocket-buffer backpressure using `ws.bufferedAmount` plus `node-pty` pause and resume support. The websocket bridge now pauses PTY output above a high-water mark and resumes it once buffered output drains below a low-water mark.
- Removed the old task-card activity preview feature entirely because it was the clearest example of non-terminal work living in the PTY output hot path. This removed summary schema fields, MCP projection, UI preview rendering, the parser implementation, and preview-only tests.
- `node-pty` supports raw-byte mode with `encoding: null` even though the published TypeScript type for `onData` still says `string`. The implementation in `node_modules/node-pty/lib/unixTerminal.js` leaves the socket undecoded when encoding is `null`, so `src/terminal/pty-session.ts` now normalizes `string | Buffer | Uint8Array` into `Buffer`.
- Checked `web-ui/node_modules/@xterm/addon-attach/lib/addon-attach.mjs`: the addon already sets `socket.binaryType = "arraybuffer"` during construction, so browser binary terminal frames are not going through Blob conversion by default.
- The biggest remaining app-specific work still near PTY output is `detectOutputTransition` in `src/terminal/session-manager.ts` plus the Claude trust prompt buffer. Those are now the main remaining reasons our loop is not as tiny as the official `node-pty` Electron example.
- Found a separate non-transport cause of terminal stutter while typing: `src/server/runtime-state-hub.ts` emits `workspace_retrieve_status` every 2 seconds, and the client used to feed that through `web-ui/src/runtime/use-runtime-state-stream.ts` reducer state. That meant App-level state changed every 2 seconds even during steady terminal typing, which could trigger wide rerenders and visible terminal jitter.
- Important follow-up: removing the heartbeat entirely fixed the stutter, but it also removed the only invalidation source for several filesystem-derived queries. That caused navbar git summary, per-task review snapshots, and review-git button visibility to go stale while agents edited files.
- Final fix shape: keep `workspace_retrieve_status` on the websocket stream, but never route it through the runtime-state reducer. `web-ui/src/runtime/use-runtime-state-stream.ts` now publishes it into `web-ui/src/runtime/workspace-retrieve-status-signal.ts`, and only targeted consumers subscribe to it with side effects.
- Reconnected consumers:
  - `web-ui/src/hooks/use-git-actions.ts`
  - `web-ui/src/hooks/use-task-workspace-snapshots.ts`
  - `web-ui/src/hooks/use-selected-task-workspace-info.ts`
- Added equality guards so unchanged git summary and selected-task workspace-info refreshes do not trigger unnecessary rerenders when the filesystem heartbeat fires.
- `detectOutputTransition` is now cheaper than before: `src/terminal/session-manager.ts` only decodes PTY output for transition detection when the adapter says inspection is relevant, and `src/terminal/agent-session-adapters.ts` restricts Codex prompt inspection to the awaiting-review state.
- Claude trust handling still exists, but it no longer polls every 150ms. `src/terminal/session-manager.ts` now detects the trust prompt directly from decoded PTY chunks we already process for Claude tasks and schedules the existing confirm timeout once. `src/terminal/claude-workspace-trust.ts` now only owns prompt detection, worktree eligibility, and confirm-timer cleanup.
