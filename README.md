## npx kanban (Research Preview)

<p align="center">
  <img src="https://github.com/user-attachments/assets/83de5f2f-1d97-4380-949b-516e2afa782e" width="100%" />
</p>

Kanban is a local browser app for running coding agents in parallel on one codebase. Each task gets its own git worktree and agent session, so you can review real diffs, leave comments, and ship work without agents stepping on each other.

> [!WARNING]
> Kanban is a research preview and uses experimental features such as autonomous agent runs, runtime hooks, and worktree automation. We'd love your feedback in **#kanban** on our [Discord](https://discord.gg/cline).

<div align="left">
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
<a href="https://x.com/cline" target="_blank">@cline</a>
</td>
</tbody>
</table>
</div>

## Get started quickly

The fastest way to try Kanban is to open a terminal in your project folder and run:

```bash
# Run directly (no global install required)
npx kanban

# Or install globally
npm i -g kanban
kanban
```

Kanban starts a local server and usually opens your browser automatically. If it cannot open the browser for you, open the printed local URL yourself. The default address is usually `http://127.0.0.1:3484`.

To get to a successful first run, you need three things: Node.js 20 or newer, Git, and one working agent path. Kanban's current production-ready launch paths are **Cline**, **Claude Code**, and **OpenAI Codex**.

If you launch Kanban outside a repository, that is still fine. Kanban can open first and let you add a project from the UI. If the folder is not yet a Git repository, Kanban can offer to initialize Git for you so task worktrees can work correctly.

## Choose your agent

If you are new to Kanban, **Cline** is the simplest place to start. Cline is built into Kanban's native runtime path, so you do not need a separate `cline` command on your PATH just to use Cline inside Kanban. Instead, you choose a provider and model in onboarding or Settings, then sign in or enter an API key.

If you already use **Claude Code**, choose Claude Code in Kanban and keep your existing workflow. The important detail is that Claude Code is set up **outside** Kanban. Kanban expects the `claude` command to already work in the same terminal environment that launches Kanban.

If you already use **Codex**, the story is similar. Kanban can drive Codex well, but Codex itself still has to be installed and authenticated outside Kanban first.

If you are unsure which path to use, start with Cline unless you already have a strong reason to stay in Claude Code or Codex.

## Your first task

When Kanban opens, you may see a **Get started** dialog. Follow it to choose an agent and, if you picked Cline, finish provider setup.

Once a project is open, create a task card with a short plain-English prompt such as “Add a loading state to the settings page” or “Fix the failing login redirect.” Then press play. Kanban creates a separate worktree for that task, starts the agent inside it, and streams progress back to the board.

As the agent works, you can watch its latest activity on the card, open the task to see a terminal or chat surface, and inspect the diff in its worktree. When the work is ready, review the changes, leave comments if needed, and then use **Commit** or **Open PR**.

## What Kanban helps with

Kanban is built around a very specific workflow: break work into tasks, let agents work in isolation, and review each task as a real code change instead of as a wall of chat output.

Each task runs in its own worktree, which means agents can work in parallel without trampling one another's files. Review happens against actual diffs, not just summaries. If you want to automate larger flows, you can link tasks so one task finishing can unblock the next.

Kanban also includes a built-in Git view for browsing branches and history, plus script shortcuts so common commands such as `npm run dev` are always one click away.

## Learn more

If you want the clearest first-time setup walkthrough, start here:

- [Getting started](./docs/getting-started.md)
- [Windows setup](./docs/windows-setup.md)
- [Choose an agent](./docs/choose-an-agent.md)
- [Cline setup](./docs/cline-setup.md)
- [Troubleshooting](./docs/troubleshooting.md)
- [How Kanban works](./docs/how-kanban-works.md)
- [Remote access and always-on Kanban](./docs/remote-access.md)

If you are working on Kanban itself rather than using it, the engineering docs index starts here:

- [Docs index](./docs/README.md)
- [Architecture overview](./docs/architecture.md)

---

[Apache 2.0 © 2026 Cline Bot Inc.](./LICENSE)
