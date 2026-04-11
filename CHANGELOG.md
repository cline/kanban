# Changelog

## [0.1.60]

- Pick from 10 new color themes to personalize your board
- Kiro CLI agent support
- Cline account organization switching and credit balance display in settings
- Editable task titles that sync across the board and detail view
- Mobile-responsive layout for the web UI, including adaptive navigation, task detail views, and chat panels
- Incremental expand in the diff viewer -- click to show 20 more lines in collapsed context blocks
- Friendly labels for task commands (like file edits and shell commands) in the sidebar chat
- Tips container in the sidebar for terminal-based agents (Claude Code, Codex, Kiro)
- HTTPS and passcode authentication support for secure remote access
- Credit limit banner now appears at the board level with a link to manage your plan
- Fixed startup onboarding reappearing after being dismissed
- Fixed browser back button not returning from task detail view to the board
- Fixed chat state not reinitializing properly when resuming a trashed task
- Fixed `/clear` not fully resetting chat for restored sessions
- Fixed diff mode toggle not reflecting its active state
- Disabled unnecessary startup update checks for Codex agent
- Faster trash restore for Codex tasks by skipping unnecessary session probes
- Updated Cline SDK from 0.0.28 to 0.0.29, which includes: unified logger interface, restructured LLM provider and model namespaces, renamed telemetry adapter, and updated system prompt API

## [0.1.59]

- Added a beta hint card to the project sidebar with quick access to send feedback or report issues
- Added "Read the docs" button in the settings dialog linking to documentation
- Adjusted prompting for the commit button to better handle stale git lock files and multiple stashes at once

## [0.1.58]

- More panels are now resizable (agent chat, git history, and more) and your layout preferences persist across sessions
- Adds full Factory Droid CLI agent support
- Add, edit, and delete custom OpenAI Compatible providers from the settings dialog
- Fixed trashed task cards being openable from the board
- Fixed git history cache not clearing when closing the view
- Terminal cursor defaults now match VS Code behavior
- Feedback widget no longer triggers authentication until you actually click it
- Updated Cline SDK from 0.0.24 to 0.0.28, which includes: OpenAI-compatible provider support via AI SDK, custom provider CRUD in core, better handling of overloaded and insufficient-credits errors, fixed tool schema format for OpenAI-compatible providers, accurate input token reporting

## [0.1.57]

- Added `kanban --update` command so you can check for and install updates manually
- Fixed Windows agents (like Codex) being incorrectly launched through cmd.exe when they're native executables
- Reduced latency when switching between projects
- Restored the feedback widget with proper JWT authentication
- Fixed telemetry service configuration for Cline agents
- Updated Cline SDK from 0.0.23 to 0.0.24, which includes reasoning details support and improved JSON Schema handling for tool definitions

## [0.1.56]

- Automatic context overflow recovery: when the conversation history exceeds the model's context window, Kanban now compacts old messages and retries instead of failing
- Credit limit errors (insufficient balance / 402) are now surfaced immediately without unnecessary retries or confusing system messages
- Added report issue and feature request links to the settings dialog
- Added Cline icon to browser notifications
- Updated Cline SDK from 0.0.22 to 0.0.23, which includes: LiteLLM private model support, provider-specific setting configs, loop detection as a built-in agent policy, provider ID normalization for model resolution, OAuth token refresh fix for spawned agents

## [0.1.55]

- Fixed non-ASCII file paths (e.g. Japanese, Chinese, Korean characters) rendering as garbled octal escape sequences in the diff view

## [0.1.54]

- Task agent chat panel resizing now persists when navigating between tasks

## [0.1.53]

- Added `/clear` slash command to reset the Cline agent chat session
- Added hints for environment variables in Cline provider setup
- Aligned Cline provider and model fallbacks with SDK defaults for more reliable configuration
- Fixed Codex plan mode not working
- Fixed slash command file watchers to reuse a single watcher per workspace instead of creating duplicates
- Show loading skeleton in onboarding carousel while videos load
- Added VS Code Insiders as a file open target

## [0.1.52]

- Added support for custom OpenAI-compatible providers, so you can connect any OpenAI-compatible API as a Cline model provider
- Added PWA support -- the web UI can now be installed as a standalone desktop app from Chrome, with window controls overlay and an offline fallback page that auto-reconnects when the server comes back
- Sticky file headers in the diff viewer now pin under the toolbar while scrolling through large diffs
- Show a cleanup spinner during Ctrl+C shutdown instead of silently hanging
- Fixed Codex status monitoring to reliably track the latest tool call
- Fixed terminal color detection for TUI apps like Codex CLI that query both foreground and background colors at startup
- Fixed activity preview text getting truncated in hooks
- Fixed project column sizing not persisting across sessions
- Fixed home sidebar session IDs not matching the current format

## [0.1.51]

- Task terminals now support multiple simultaneous viewers, so opening the same task in several browser tabs no longer causes disconnections
- Terminal TUI state is now preserved across reconnects, so you no longer lose your terminal view when the connection drops and re-establishes
- Fixed Codex CLI content disappearing or rendering incorrectly -- PTY sessions are now fully server-side, so you can refresh the page, switch between tasks, and unmount terminals without losing any output
- Fixed home sidebar terminal sessions not reconnecting after navigation
- Switched to esbuild for faster builds
- Claude agent hyperlinks now render correctly in Kanban terminals
- Fixed screen flickering and unnecessary polling when viewing trashed tasks
- Fixed restoring tasks from trash using the wrong agent
- Fixed stale git worktree registrations that could cause worktree operations to fail

## [0.1.50]

- Updated Cline SDK from 0.0.21 to 0.0.22, which includes: fixed hook worker process launching to use a more robust internal launch mechanism

## [0.1.49]

- Updated Cline SDK from 0.0.16 to 0.0.21, which includes: organization fetching support, SDK declaration maps for better type resolution, OpenAI Compatible provider migration and cleanup of the legacy provider, agent telemetry events with agent ID and metadata, bash tool and home directory fixes on Windows, and exposed LoggerTelemetryAdapter in the node package

## [0.1.48]

- Fixed sidebar agent attempting to edit files and write code instead of staying focused on Kanban board management

## [0.1.47]

- Fixed browser open failing on Linux systems where `xdg-open` is not available

## [0.1.46]

- Added reasoning level dropdown to Cline provider settings and the model selector in the chat composer
- Images can now be attached when creating tasks for Claude Code and Codec CLI agents -- images are saved as temporary files and their paths are passed into the prompt since TUIs don't support inline images
- Added shortcuts for diff view actions and a "Start and Open" shortcut as an alternative to starting a task (shout out to Shey for the idea!)
- Fixed issues with the sidebar Cline chat session not reloading after adding MCP servers
- The project column can now be collapsed all the way to the edge for a minimal view (shout out to Shey for this idea!)
- Fixed issues with some Next.js project configurations in worktrees
- Fixed diff viewer showing false changes for end-of-file-only differences
- Fixed a crash in older browsers when generating UUIDs for board state
- Fixed a crash on Windows when resizing the terminal after the PTY process has exited

## [0.1.45]

- Fixed kanban access validation to only apply restrictions to enterprise customers, so non-enterprise users are no longer incorrectly blocked

## [0.1.44]

- Fixed remote configuration not being applied correctly

## [0.1.43]

- Kanban access can now be gated via Cline remote config
- Fixed "C" (create task) keyboard shortcut crashing when no projects exist
- Fixed macOS directory picker treating cancel as an error instead of a normal cancellation
- Improved agent selection copy during onboarding
- File paths in the settings dialog now display with `~` instead of the full home directory
- Fixed incorrect "kanban" branding in the disconnected screen (now says "Cline")
- Fixed cancel button showing wrong label in detail view panels
- Temporarily disabled Featurebase feedback widget

## [0.1.42]

- Fixed auto-update failing on Windows by using the correct `.cmd` extensions for package manager commands (npm, pnpm, yarn)

## [0.1.41]

- Cline agent sessions now automatically recover after a runtime teardown, so work isn't lost if the runtime restarts
- Per-task plan/act mode now persists when switching between tasks
- Chat messages sent while the agent is actively working are now queued and delivered when the turn completes, instead of being dropped
- Fixed repeated MCP OAuth callbacks causing errors when the browser fires the redirect more than once
- Fixed corrupt patch captures when trashing tasks in worktrees
- Session IDs are now sanitized for Windows-safe file paths
- Agent mistake tolerance increased from 3 to 6 consecutive errors, giving the agent more room to recover from transient failures
- Fixed the navbar agent setup hint showing incorrect state
- Use the `open` package for cross-platform URL opening instead of custom logic
- Updated Cline SDK to 0.0.15 with file-based store fallbacks, remote config support, improved chat failure handling with message state rollback, and a new `maxConsecutiveMistakes` option to prevent agents from getting stuck in failure loops

## [0.1.40]

- Sidebar agent now stays focused on board management and redirects coding requests to task creation, so dedicated agents handle implementation work in their own worktrees
- Fixed feedback widget initialization for Cline-authenticated users

## [0.1.39]

- Fixed the feedback widget not opening reliably when clicking "Share Feedback"
- Capitalized button labels for consistency ("Add Project", "Share Feedback")

## [0.1.38]

- First-run onboarding for script shortcuts -- new users are guided through creating their first shortcut directly from the top bar
- Settings file URLs can now be opened
- Fixed terminal bottom pane content clearing when running script shortcuts

## [0.1.37]

- Slash commands and file mentions in the client chat input field
- Share Feedback button in the bottom left, powered by Featurebase and enriched with Cline account data like email so we can see who reports are coming from, with a Linear integration for automatic issue creation
- MCP OAuth callbacks consolidated onto the main runtime server with real-time auth status updates
- Linear MCP shortcut for one-click install setup
- Updated startup onboarding carousel with a screen about using camera and the agent to add tasks
- Conversation history always visible in detailed task view
- Fixed an issue where adding MCPs wouldn't be available in existing Cline chats -- adding MCPs now resets Cline chats to use them
- Fixed an issue where the client chat would get into a "task chat session is not running" error state. You can now send a message to continue the conversation when Cline fails a tool call
- Fixed an issue where binary diffs would not show up in diff views
- Diff renderer groups removals before additions for easier reading
- Fixed default model selection when OAuth login leaves it blank
- Updated Cline SDK with fixes for ask question tool being disabled in yolo mode, cost calculation, and tool description and truncation logic improvements

## [0.1.36]

- Added Sentry error reporting to help identify and fix crashes faster
- Fixed terminal sessions sometimes failing to reconnect, which caused the terminal emulator to scroll to the top during card transitions before scrolling back down
- Fixed onboarding to default to Cline as the AI provider and automatically set the provider's default model, preventing errors when switching providers without updating the model
- Fixed Ctrl+C to wait for Cline to finish shutting down before fully exiting, preventing false double-interrupt exits
- Upgraded Cline SDK from 0.0.7 to 0.0.11 with numerous fixes and improvements:
  - Fixed prompt caching being broken for Anthropic models, meaning users were paying full price every turn. Cost calculation was also fixed (it was double-counting cache reads and ignoring cache writes)
  - Fixed cancelling a request causing all subsequent requests in the session to immediately fail, due to a reused AbortController
  - Fixed Gemini tool use failing for most non-trivial tool schemas. JSON Schema properties not in Gemini's allowed set (like `default`, `pattern`, `minLength`) caused Gemini to reject entire requests
  - Fixed tools with no required parameters (like "list all") being silently dropped
  - Fixed CLI hanging indefinitely in CI/Docker environments when stdin was detected as "not a TTY" but wasn't providing input
  - Fixed Vercel AI Gateway being completely broken (base URL was `.app` instead of `.sh`, so all requests 404'd)
  - Fixed internal metadata fields leaking into API requests sent to providers, wasting tokens
  - Fixed multi-agent team tools failing when the orchestrator sent null for optional filter parameters. Also added concurrent run prevention and better error visibility for teammate failures
  - Fixed MCP tool names with special characters or exceeding 128 chars causing provider schema validation errors (now sanitized with a hash suffix)
  - Fixed OpenRouter and other gateway error messages showing opaque nested JSON blobs instead of the actual error
  - Fixed `--json` mode output being impure (plain text warnings leaked into stdout, breaking JSONL parsing)
  - Fixed SQLite crashing with a disk I/O error on first run instead of auto-creating the data directory
  - Fixed "Sonic boom is not ready yet" error on CLI exit
  - Removed hardcoded 8,192 max output tokens per turn cap, so models are no longer artificially limited
  - Added OpenAI-compatible prompt caching support
  - Added OpenAI-compatible providers now surface truncated responses (`finish_reason: "length"`) so callers can detect them
  - Headless mode no longer requires a persisted API key -- env vars like `ANTHROPIC_API_KEY` now work
  - Headless mode output cleaned up: model info, welcome line, and summary gated behind `--verbose`
  - Config directory is now overridable via `--config` flag or `CLINE_DIR` env var for isolated config across multiple SDK instances
  - `readFile` executor now supports optional `start_line`/`end_line` parameters, enabling models to read specific portions of large files

## [0.1.35]

- Added runtime debug tools accessible from the top bar for troubleshooting configuration and agent state
- Settings now automatically retry loading when the initial attempt fails, improving reliability on slower connections

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
