# kanban

A kanban board for coding agents.

CLI agents are powerful, but using more than one at a time is a mess. You end up juggling terminals, worrying about git conflicts, and manually coordinating who works on what. Kanban gives you a simple pattern: a kanban board where each task runs its own agent in its own git worktree, completely isolated from everything else.

You create tasks, hit play, and watch agents work in parallel. When they finish, you review the diffs, leave comments, and merge. That's it.

## Quick start

```bash
npx kanban
```

This launches the web UI in your browser and starts the local runtime server. Kanban auto-detects which CLI agent you have installed and uses it to run tasks.

If you have multiple agents installed, you can pick one:

```bash
npx kanban --agent claude
```

Supported agents: `claude`, `codex`, `gemini`, `opencode`, `cline`

## How it works

Kanban is a local-only tool. Nothing leaves your machine. It runs an HTTP server on `127.0.0.1:8484` and opens a web UI where you manage everything.

The core idea is simple:

1. You add tasks to the backlog. Each task is just a prompt describing the work.
2. When you start a task, Kanban creates a git worktree for it and launches your chosen CLI agent inside that worktree. The agent works in total isolation from your main branch and from every other task.
3. While agents work, the board shows live status. You can see which tasks are running, which are waiting for review, and what each agent is doing.
4. When an agent finishes (or needs input), the task moves to review. You see the full diff of every change, can leave line comments, and decide what to do next.
5. You merge the work, send it back for more changes, or toss it.

Multiple agents run simultaneously without stepping on each other because each one gets its own worktree. You don't have to think about branches or conflicts until you're ready to merge.

## The MCP server

Kanban includes an MCP server that lets your agent manage the board directly. This is where things get interesting: an agent can create tasks, tune their automation settings, link dependent work together, start them, and inspect what's on the board, turning a single agent into an orchestrator that delegates work to other agents.

To add the MCP server to your agent, point it at:

```bash
kanban mcp
```

The MCP server exposes these tools:

- `list_tasks` -- see what's on the board, including task links and auto-review settings
- `create_task` -- add a new task to backlog, optionally with auto-review enabled
- `update_task` -- change a task's prompt, base ref, plan mode, or auto-review settings
- `link_tasks` -- link tasks so backlog work can wait on another task
- `unlink_tasks` -- remove an existing task link
- `start_task` -- kick off a task (creates the worktree, launches the agent)

Task linking is useful both for parallelization and for dependencies. When a larger effort is easy to break into multiple tasks that can be done in parallel, link multiple backlog tasks to the same dependency so they all become ready to start once that dependency finishes. When one piece of work depends on another, use links to represent that follow-on dependency. A link requires at least one backlog task. When the linked task eventually reaches review and gets moved to trash, the waiting backlog task becomes ready to start automatically.

Auto-review settings let a task automatically make a commit, open a PR, or move itself to trash after it reaches review.

This means you can tell your agent something like "break this feature into subtasks on the kanban board, then start them all" and it will use the MCP tools to do exactly that. Each subtask runs in its own worktree with its own agent instance, all managed through the board.

## CLI reference

```
kanban [options]

Options:
  --port <number>   Bind the runtime server to a specific port (default: 8484)
  --agent <id>      Set the default agent (claude, codex, gemini, opencode, cline)
  --no-open         Don't auto-open the browser
  --help            Print usage
  --version         Print version

Subcommands:
  kanban mcp     Run as an MCP stdio server
```

After installing globally, you can also view the man page:

```bash
man kanban
```

## Why a kanban board?

The problem with running multiple agents isn't the agents themselves. It's coordination. You need to know what's happening, what's done, and what needs your attention. A kanban board is a natural fit because it gives you that visibility without adding process overhead.

The columns map directly to agent lifecycle:

- Backlog: work that's defined but not started
- In Progress: an agent is actively working on it
- Review: the agent is done (or paused) and needs your eyes
- Done: merged and finished

Each transition happens automatically. When you start a task, it moves to in progress. When the agent finishes or hits a permission boundary, it moves to review. You drag it back to in progress if you want the agent to keep going.

This pattern scales. Five tasks running in parallel looks the same as one. You just check the board and handle whatever's in review.

## Contributing

See [DEVELOPMENT.md](DEVELOPMENT.md) for setup instructions, scripts, and architecture details.

## License

Apache-2.0
