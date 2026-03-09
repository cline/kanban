# kanban (Research Preview)

A Human-in-the-Loop Agent Swarm Orchestration layer that gives more autonomy to your CLI agents with task dependency linking and automatic commits and pull requests. Each task runs in its own branchless worktree with .gitignore'd files like node_modules symlinked so your filesystem and git don't get polluted, letting you run hundreds of tasks in parallel on any computer. It also comes with a visualizer for your git branches and commit history, so you can keep track of the work your agents do.

1. Install an agent like Claude Code, Codex, Gemini, OpenCode, Cline
2. Run `npx kanban` (or install with `npm i -g kanban`) in your repo to launch a web GUI
3. Create tasks, link dependencies, hit the play button, and watch agents work in parallel. You can even use Kanban MCP to tell an agent to create parallelizable tasks and links in clever ways to get projects done quickly.
4. When they finish, you review diffs, leave comments, and commit or make a PR.

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://www.npmjs.com/package/kanban" target="_blank">NPM</a>
</td>
<td align="center">
<a href="https://github.com/cline/kanban" target="_blank">GitHub</a>
</td>
<td align="center">
<a href="https://github.com/cline/kanban/issues" target="_blank">Issues</a>
</td>
<td align="center">
<a href="https://github.com/cline/kanban/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank">Feature Requests</a>
</td>
<td align="center">
<a href="https://discord.gg/cline" target="_blank">Discord</a>
</td>
<td align="center">
<a href="https://x.com/caborncline" target="_blank">@cline</a> / <a href="https://x.com/sdrzn" target="_blank">@sdrzn</a>
</td>
</tbody>
</table>
</div>

```bash
npx kanban
```

This is where things get interesting. The MCP server lets your agent become an orchestrator that delegates work to other agents.

Add it to your agent:

```bash
claude mcp add --transport stdio --scope user kanban -- kanban mcp
```

With the MCP tools, your agent can:

- `list_tasks` / see what's on the board, including task links and auto-review settings
- `create_task` / add a new task to backlog, optionally with auto-review enabled
- `update_task` / change a task's prompt, base ref, plan mode, or auto-review settings
- `link_tasks` / link tasks so backlog work waits on another task to finish first
- `unlink_tasks` / remove a task link
- `start_task` / kick off a task (creates the worktree, launches the agent)

Task linking handles both parallelization and dependencies. Link multiple backlog tasks to the same dependency and they all become ready once it finishes. Auto-review settings let a task automatically commit, open a PR, or clean itself up after reaching review.

Tell your agent "break this feature into subtasks on the kanban board, then start them all" and it will use the MCP tools to do exactly that. Each subtask runs in its own worktree with its own agent instance.

## License

[Apache 2.0 (c) 2026 Cline Bot Inc.](./LICENSE)
