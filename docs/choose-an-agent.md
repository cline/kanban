# Choose an Agent

Kanban's current production-ready launch paths are **Cline**, **Claude Code**, and **OpenAI Codex**.

That is the most important thing to know up front. You may still see references to other agents in older changelog entries or experimental code paths, but if you want the clearest, best-supported experience today, choose from those three.

## The short version

Choose **Cline** if you are new to Kanban or want the most integrated setup. Cline is built into Kanban, which means setup happens inside the app instead of depending on an external CLI command being available on your PATH.

Choose **Claude Code** if you already use Claude Code and want Kanban to layer review, worktrees, and task management on top of your existing workflow.

Choose **Codex** if Codex is already part of your normal setup and you want Kanban to orchestrate work around it.

## A simple comparison

| Agent | Best for | Where setup happens | What you need first |
| --- | --- | --- | --- |
| Cline | new users and people who want an integrated setup flow | inside Kanban | a provider, a model, and either OAuth sign-in or an API key |
| Claude Code | existing Claude Code users | outside Kanban | a working `claude` command in the terminal that launches Kanban |
| Codex | existing Codex users | outside Kanban | a working `codex` command in the terminal that launches Kanban |

## Cline

Cline is the most natural default for many new users because it is part of Kanban's native runtime path. In practice, that means you do not need to install and detect a separate CLI just to get your first task working in Kanban.

Instead, you choose a provider and model in onboarding or Settings, then complete authentication there. Once that is done, Kanban can use Cline for task work and for the project-scoped sidebar chat.

If you want the simplest explanation of when to choose Cline, it is this: choose it when you want Kanban itself to guide the setup.

## Claude Code

Claude Code is a strong choice if you already trust that workflow and want Kanban mainly for task orchestration, isolated worktrees, review, and Git integration.

The important difference is that Claude Code is not configured inside Kanban. Kanban expects the `claude` command to already be installed and usable in the terminal session that launches Kanban. If the command is installed somewhere else or only works in a different shell environment, Kanban will not be able to launch it reliably.

Choose Claude Code when you already have it working and want Kanban to add structure around it, not when you want Kanban to teach you how to install it from scratch.

## Codex

Codex fits the same general pattern as Claude Code. Kanban can run it well, but Codex itself remains an external tool that needs to be installed and authenticated outside Kanban first.

Choose Codex if it is already part of your existing toolchain. If you are starting from zero and do not have a reason to prefer it, Cline will usually be easier to get running inside Kanban.

## So which one should most people pick first?

For most first-time Kanban users, the answer is **Cline**.

Not because Claude Code or Codex are worse, but because Cline removes one whole category of first-run friction. You do not need to prove that an external CLI is already visible on your PATH before Kanban can help you. You simply complete provider setup in the UI and continue.

If you are already a committed Claude Code or Codex user, then the best first pick is usually the tool you already know.

## What if you change your mind later?

That is normal. You can switch agents in **Settings**. Kanban is designed so the board, worktree model, and review workflow stay the same even if the agent changes.

If you decide to switch to Cline later, use the [Cline setup guide](./cline-setup.md). If a task will not start after switching, the [troubleshooting guide](./troubleshooting.md) is the right next stop.