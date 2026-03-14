# Changelog

## [0.1.12]

- Redesigned the web UI with a refined dark theme, custom UI primitives, and polished controls for a more professional look and feel
- Added split diff view so you can click the expand button above any diff to see changes side by side
- Added last turn changes, which takes a Git snapshot each time you send a message to your agent so you can see exactly what changed since your last message
- Added an all changes view to see every modification in a task's worktree at a glance
- Resizable agent terminal emulator so you can drag to make it bigger or smaller
- Inline task creation controls with keyboard shortcut hints
- Fix diff panel persisting stale content when switching views
- Fix last-turn diff transitions flickering during scope changes
- Only keep terminal connections alive for tasks actively on the board, and clean them up when the runtime disconnects
- Fix WebSocket proxy so terminal connections work correctly during local development
- Fix the dogfood launcher not waiting for the child process to exit, which could leave orphaned processes on shutdown

## [0.1.11]

- Add Kanban skill for creating and managing tasks directly from your agent
- Remove Kanban MCP server in favor of skill-based task automation

## [0.1.10]

- Add "Start task" button to create task card -- press `c` to create, type your task, then Cmd+Shift+Enter to start it right away
- Add "Cancel auto-review" actions to task cards
- Add "Start All" button to backlog column header to start all backlog tasks at once
- Add Cmd+Enter shortcut for sending diff comments
- Show keyboard shortcut hints on the create task button
- Simplified shortcut icon picker
- Show authentication warning callout in Linear MCP setup dialog
- Show loading state on trash button while deleting
- Resume paused droid tasks when read/grep hooks fire
- Fix stale diff persisting when switching between task details
- Fix stale script shortcuts lingering after switching projects
- Fix git history flicker during scope switches
- Fix terminal rendering for Droid CLI in split terminals
- Fix linked task start animations
- Detect when GitHub/Linear/Kanban MCPs are already installed to skip unnecessary setup dialogs
- Fix resuming trashed tasks after terminal refactors
- Fix Droid CLI review state transitions around AskUser tool calls
- Default new users to Cline CLI when installed
- Highlight active branch button in blue
- Fix settings dialog appearing disabled during config refresh
- Center selected detail card in sidebar

## [0.1.9]

- Fix worktree paths with symlinks in ignored directories being incorrectly treated as active

## [0.1.8]

- Terminal now properly renders full-screen TUI applications like OpenCode
- Fixed terminal content disappearing and scroll back being lost when opening a task. Terminals are now created proactively for each agent instead of connecting mid-session, which preserves full scroll back and content rendering. This is especially important for rendering TUI apps like Codex and Droid correctly.
- Improved terminal rendering quality, inspired by VS Code's xterm and node-pty implementation. Noticeably higher FPS, smoother scrolling, and a more native look and feel for terminal emulators.

## [0.1.7]

- When a task prompt mentions creating tasks (e.g. "break down into tasks", "create 3 tickets", "split into cards"), Kanban now shows a setup dialog offering to install the Kanban MCP before the task starts
- Similar setup dialogs appear for Linear and GitHub CLI when task prompts reference those services
- MCP server instructions now guide agents to detect the ephemeral worktree path and pass the main worktree as projectPath, so "add tasks in kanban" tasks correctly create tasks in the main workspace instead of the ephemeral task worktree

## [0.1.6]

- Show live hook activity (tool calls, file edits, command runs) on task cards as agents work
- Auto-confirm Codex workspace trust prompts so tasks start without manual intervention
- Show working copy changes in the detail panel's git history
- Fix terminal pane state bleeding across tasks when switching between them
- Fix duplicate paste events in agent terminals
- Stop detail terminals when trashing tasks to free resources
- Automatically pick up new versions when launching with `npx kanban`
- Fix git metadata not updating reliably when switching projects
- Stabilize workspace metadata stream startup

## [0.1.5]

- Added Droid CLI agent support alongside Claude and Codex
- Dogfood launcher for quickly opening Kanban on its own repo with runtime port selection
- Terminal rebuilt around xterm and node-pty for better performance and reliability
- Filter terminal device attribute auto-responses from being sent to agents as input
- Fix workspace metadata causing unnecessary rerenders, with retry recovery
- Fix task worktrees being recreated when the base ref updates if they already exist
- Fix self-ignored directories being symlinked in task worktrees
- Fix bypass permissions toggle resetting unexpectedly
- Fix git refs not clearing when switching detail scope

## [0.1.4]

- Each task gets its own CLI agent working in a git worktree, so they can work in parallel on the same codebase without stepping on each other
- When an agent finishes, review diffs and leave comments before deciding what to merge
- Commit or open a PR directly from the board, and the agent writes the commit message or PR description for you
- Link tasks together to create dependency chains, where one task finishing kicks off the next, letting you complete large projects end to end
- "Automatically commit" and "automatically open PR" toggles give agents more autonomy to complete work on their own
- MCP integration lets agents add and start tasks on the board themselves, decomposing large work into parallelizable linked tasks
- Built-in git visualizer shows your branches and commit history so you can track the work your agents are doing
