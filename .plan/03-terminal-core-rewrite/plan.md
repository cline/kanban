# Terminal Core Rewrite

Goal: simplify the terminal architecture so the browser terminal path is a straightforward xterm to websocket to PTY integration, with Kanban agent orchestration layered above it instead of mixed into it.

## Planned work

1. Establish a clear terminal core boundary on the client and server.
2. Refactor server terminal handling so PTY transport logic is easier to follow and less entangled with agent state logic.
3. Refactor client terminal surfaces to share one runtime path.
4. Route active-session app actions through the shared terminal runtime and reduce fallback paths.
5. Verify behavior and delete dead code.
