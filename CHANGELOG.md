# Changelog

## [0.1.34]

- Model pickers now show recommended Cline models for quick selection
- Failed tasks show a red error icon and failure reason on the board card instead of a spinner
- When adding a project on a headless/remote runtime where no directory picker is available, you can now enter the project path manually
- Fixed workspace not refreshing correctly on startup by waiting for the runtime snapshot before syncing
- Fixed Kanban agent creating tasks for worktree paths instead of the main project

## [0.1.33]

- Fixed task worktree setup for Turbopack projects no longer attempting slow background copies of node_modules; affected subproject dependencies are now correctly skipped instead of symlinked

## [0.1.32]

- Fix concurrent task mutations (e.g. adding multiple tasks at the same time) failing due to write conflicts -- task mutations now use a workspace lock to safely handle simultaneous operations
- Fix a bug where stopping a task that was restored from a previous session would fail because the session wasn't properly reconnected on startup
- Fix a bug where restarting the app would show raw metadata in user messages for old Cline sessions that were reloaded
- Fix worktrees for projects using Turbopack, where symlinked node_modules would cause build failures -- worktrees now fall back to copying node_modules for Turbopack projects
- Fix SDK command parsing that could cause agent system prompts to be malformed
- Fix Cmd+V image paste in the chat composer not working due to the paste handler running asynchronously, causing the browser to swallow the event
- Fix proper-lockfile crashing due to accidentally passing undefined as the onCompromised handler
- Require confirmation before git init when adding projects
- Fix task card agent preview flickering to empty state
- Cancel inline task edit on Escape key press
- Move task worktrees to ~/.cline/worktrees
- Update onboarding intro video and frame width
- Change the start-all-tasks shortcut to Cmd+B

## [0.1.31]

- Add ability to resume Cline tasks that were trashed
- Support image attachments for Cline agent chat
- Fix the commit and make PR button in the Cline agent chat panel
- Fix issue where creating multiple tasks at the same time with git submodules would run into a git config locking issue
- Fix script shortcuts to interrupt previously long-running commands, so you no longer need to Ctrl+C before hitting the shortcut again
- Fix issue where running incorrect kanban commands would auto-open the browser
- Preserve runnable kanban command in sidebar prompt
- Avoid premature Codex review state transitions
- Fix diff "Add" button incorrectly sending Cline chat messages
- Various UX improvements (checkbox labels, Cline thinking shimmer animation)

## [0.1.30]

- Add MCP server management and OAuth authentication for Cline providers
- Add "Start All Tasks" keyboard shortcut (Alt + Shift + S)
- Show assistant response previews in task card activity instead of generic "Agent active" text
- Track full chat history per task, enabling richer conversation display and reliable message streaming
- Display API key expiry as a human-readable date instead of a raw number
- Support launching Kanban without a selected project (global-only mode)
- Automatically restart agent terminals when the underlying process exits unexpectedly
- Fix prewarm cleanup accidentally disposing the detail panel terminal for active tasks
- Fix task card expand animation jumping by waiting for measured height before animating
- Fix Cline thinking indicator flicker in the chat panel

## [0.1.29]

- Fix onboarding and settings screens not working when no projects exist
- Update Cline SDK with auth migration for existing CLI users and fixes for OpenAI-compatible APIs

## [0.1.28]

- Onboarding dialog for first-time users with guided walkthroughs for auto-commit, linking, and diff comments
- Dependency links now show arrowheads so you can see direction at a glance, and the agent provides guidance about link direction when creating them
- Cline chat input field now includes a model selector, plan/act mode toggle, and a cancel button to stop generations midstream
- Resizable project sidebar (drag to resize, persists across sessions)
- Show the full command in expanded run_commands tool calls
- Review actions (Commit, Open PR) only appear when there are actual file changes
- Cline chat preserves your scroll position when reading older messages
- Failed tool calls display proper error messages instead of deadlocking the session
- "Thinking" indicator shows while tool calls are loading
- ANSI escape codes from CLI output are stripped instead of showing raw characters
- Inline code in Cline chat wraps correctly instead of overflowing
- Tasks with uncompleted dependencies can no longer be started
- Better error reporting when Cline fails to start (clear messages instead of silent hangs)
- Gracefully handles missing provider settings instead of crashing
- Removed OpenAI, Gemini, and Droid agents to reduce surface area at launch (coming back in follow-up releases)

## [0.1.27]

- Upgraded Cline SDK to stable v0.0.4, replacing nightly builds for more reliable native Cline sessions

## [0.1.26]

- Trashing a task now saves a git patch of any uncommitted work, and restoring it from trash automatically reapplies those changes so nothing gets lost
- "Create more" toggle in the new task dialog lets you create multiple tasks in a row without reopening the dialog each time
- New keyboard shortcuts: Cmd/Ctrl+G toggles the git history view, Cmd/Ctrl+Shift+S opens settings, and Esc closes git history from the home screen
- Shortcut commands now safely interrupt any running terminal process before executing, so commands no longer get jumbled with whatever was previously running
- Agent file-read activity now shows the full list of files being accessed instead of truncating with "(+N more)"
- Expanding the diff view now automatically closes the terminal panel to avoid overlapping views
- Task worktree cleanup no longer gets stuck when patch capture fails
- Fixed the "Thinking..." indicator incorrectly appearing while the agent is actively streaming a response
- Native Cline sessions now correctly capture their latest changes when entering review
- Removed the redundant "Projects" label below the sidebar segment tabs
- Consistent spacing and alignment across all alert dialogs
- Fixed terminal background color in the detail view to match the rest of the overlay

## [0.1.25]

- Added a chat view to the home sidebar for project-scoped agent conversations. What used to be the project column is now a sidebar that can switch between projects and chat.
- The agent can now trash and delete tasks on your behalf using new task management commands
- When no CLI agent is detected, a guided setup flow walks you through getting started
- Replaced the Kanban skill system with `--append-system-prompt` -- since the board now has a dedicated agent, we just append context to its prompt instead of maintaining a separate skill
- Native Cline SDK chat runtime with cancelable turns
- `--host` flag to bind the server to a custom IP address
- Submodules are now initialized automatically in new task worktrees
- Fix Escape key unexpectedly closing the detail view
- Increased shortcut label and footer font sizes
- Capped agent preview lines in task cards

## [0.1.24]

- Fixed multiline prompt arguments being broken on Windows cmd.exe

## [0.1.23]

- Fix Windows terminal launches incorrectly escaping arguments with spaces, parentheses, and other special characters

## [0.1.22]

- Fix Windows terminal launch failing for bare executables (e.g. `cline`) due to unnecessary quoting

## [0.1.21]

- Fix Windows agent commands failing to launch
- Fix update detection for Windows npm-cache npx transient installs
- Reduce false-positive triggering of the kanban skill
- Show worktree errors in toasts

## [0.1.20]

- Fix branch picker showing remote tracking refs instead of just local branches, and enable trackpad scrolling in the picker
- Fix task card activity not updating when Opencode completes hook actions
- Fix Cline tasks getting stuck instead of returning to in-progress when asking follow-up questions during review

## [0.1.19]

- Fixed a race condition where navigating to a task's detail view could trigger an unintended auto-start
- Fixed shutdown cleanup to reliably stop all running tasks across projects

## [0.1.18]

- Fix layout stability when moving cards between columns programmatically
- Improve checkbox contrast on dialog footers
- Reduce dialog header/footer side padding to match vertical padding
- Fix description briefly flashing on card mount

## [0.1.17]

- Fix keyboard shortcuts (Cmd+Enter) not working when focus is on dialog inputs

## [0.1.16]

- Fixed agent startup reliability and command detection
- Fixed path handling on Windows and Linux for cross-platform support

## [0.1.15]

- Fix diff view syntax highlighting colors in git history
- Improve graceful shutdown handling for CLI processes
- Fix worktree symlink mirroring for ignored paths to avoid blocking operations
- Fix process cleanup on Windows when tasks time out
- Support Windows AppData path discovery for Opencode integration
- Make "Open in Editor" workspace actions work correctly across platforms
- Add directory picker support on Windows
- Fix transcript path detection in hooks
- Handle Linux directory picker fallbacks and errors gracefully

## [0.1.14]

- Fixed a crash on Linux systems where no browser opener (xdg-open, etc.) was available

## [0.1.13]

- New task creation dialog with list detection for quickly creating multiple tasks at once
- Git history now shows remote refs and branch divergence so you know if you need to pull
- Expandable task card descriptions -- click to reveal the full description inline
- Notifications now show the latest agent message
- Improved split diff rendering by consolidating same hunk changes
- Fixed issue where cards in the kanban column updating content would cause scroll jumps

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
