# Status

Started: March 10, 2026

Current phase:

- hot-path simplification and verification

Completed:

- captured the rewrite plan in `.plan/docs/terminal-core-rewrite-plan.md`
- created a body-of-work tracker for the rewrite
- extracted a reusable server-side PTY session core into `src/terminal/pty-session.ts`
- introduced a minimal terminal transport boundary in `src/terminal/terminal-session-service.ts`
- narrowed `src/terminal/ws-server.ts` to depend on the terminal session service interface instead of the full session manager class
- refactored `src/terminal/session-manager.ts` so PTY lifecycle and output history management live in the PTY core instead of inline in the manager
- renamed the shared client runtime hook from `use-agent-terminal` to `use-terminal-session` to reflect that both terminal surfaces use the same terminal session layer
- reduced websocket output latency for small bursts and enabled `TCP_NODELAY` on terminal sockets in `src/terminal/ws-server.ts`
- added real websocket-buffer backpressure in `src/terminal/ws-server.ts` by pausing and resuming PTY output through the terminal session service
- removed the task activity-preview feature end to end from the backend session summary, MCP projection, board card UI, detail-view toolbar UI, parser implementation, and preview-only tests
- switched `src/terminal/pty-session.ts` to `node-pty` raw-byte mode with `encoding: null` so PTY output stays as bytes until a caller actually needs decoded text
- kept browser terminal IO on binary websocket frames and confirmed `@xterm/addon-attach` already forces `binaryType = "arraybuffer"` in the client
- trimmed the input hot path so `writeInput` forwards buffers directly to the PTY and only inspects raw bytes for the Codex newline case
- removed the 2-second App-level render pulse caused by `workspace_retrieve_status` updates flowing through `web-ui/src/runtime/use-runtime-state-stream.ts`
- moved workspace-retrieve heartbeats into a small external event store and changed filesystem-refresh hooks to subscribe with side effects instead of render-time state reads
- narrowed Codex output inspection so PTY chunks are only decoded for prompt detection when the session is actually in the awaiting-review state
- kept Claude trust handling but removed its polling loop, switching it to event-driven prompt detection on incoming PTY data
- restored the 2-second filesystem heartbeat as a narrow invalidation signal for git and workspace-derived queries without routing it back through the main runtime-state reducer
- reconnected stale git and task snapshot consumers to that signal in `use-git-actions.ts`, `use-task-workspace-snapshots.ts`, and `use-selected-task-workspace-info.ts`
- added equality guards so unchanged git summary and workspace-info fetches do not force unnecessary rerenders
- verified the refactor with root and web typechecks and tests after each hot-path change

Next:

- verify in-app that navbar git summary and per-task review snapshots now update again while agents edit files, without reintroducing the old typing stutter
- evaluate whether `detectOutputTransition` and Claude trust prompt handling can be moved even farther off the PTY output path without breaking agent behavior
- add runtime diagnostics if needed to confirm WebGL renderer activation during manual testing

Blockers:

- none currently
