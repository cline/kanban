# Troubleshooting

Most first-run problems with Kanban fall into one of three buckets: the browser did not open the app, the project was not ready for Kanban's Git workflow, or the selected agent was not actually ready to run.

This guide focuses on the common cases that are easy to fix once you know what Kanban is expecting.

## Kanban did not open in my browser

Kanban starts a local server. In most cases it opens your browser automatically, but that convenience can fail on some systems. If it does, use the local URL printed in the terminal. The default address is usually:

```text
http://127.0.0.1:3484
```

If the default port is busy, Kanban may reuse an existing Kanban server or you can launch a fresh instance on another port with:

```bash
npx kanban --port auto
```

If you are on a machine without a normal desktop browser workflow, manual navigation to the printed URL is the expected fallback.

On Windows, it is especially worth trusting the printed local URL if the browser does not open automatically. A failed auto-open does not necessarily mean Kanban failed to start.

## Kanban opened, but it says “No projects yet”

That message usually means one of two things: either you launched Kanban outside a project folder, or you have not added any projects yet.

Click **Add project** and choose the folder you want Kanban to work with. If that folder is already a Git repository, Kanban can start using it immediately. If it is not, Kanban may ask whether you want to initialize Git.

This is normal. Kanban depends on Git worktrees, so it cannot do its main job unless the project is under version control.

## Why is Kanban asking to initialize Git?

Kanban creates a separate worktree for each task so agents can work in parallel without stepping on one another. Git only supports that cleanly when the project is already a repository.

If you approve initialization, Kanban will create a new Git repository, stage the current files, and make an initial commit. That gives it a stable baseline for future worktrees and diffs.

If that is not what you want, cancel and prepare the repository yourself first.

## Kanban opened, but I cannot start tasks

When a task will not start, the first thing to check is whether your selected agent is actually ready.

Today, Kanban's launch-supported choices are Cline, Claude Code, and Codex.

If you selected **Cline**, make sure you completed provider setup and authentication in onboarding or Settings. Cline is only considered ready when it has a real provider choice and valid authentication.

If you selected **Claude Code** or **Codex**, make sure the external command is already installed and usable in the same terminal environment that launches Kanban.

The simplest way to test that is to run one of these in the same shell:

```bash
claude --help
# or
codex --help
```

If the command does not work there, Kanban will not be able to launch it either.

## Kanban says “No agent configured”

Open **Settings** and look at **Agent runtime**.

If you want the most direct path forward, switch to **Cline** and complete its setup. If you want to use Claude Code or Codex instead, install and authenticate that tool first, then relaunch Kanban from the same terminal environment.

If you already installed the agent but Kanban still does not see it, the problem is usually not the app itself. It is usually that the command is not visible in the current shell environment.

On Windows, that often means the command works in one terminal session but not in another. The practical test is simple: in the same terminal where you plan to run Kanban, try the agent command directly first.

## Cline is selected, but it is still not ready

Open **Settings** and look at the **Cline setup** section.

Make sure all three of these are true:

1. a provider is selected
2. a model is selected
3. authentication is complete

If the provider uses OAuth, use the sign-in button and wait for the UI to show that you are signed in. If the provider uses an API key, enter the key and save your settings.

If you want a more complete explanation of provider setup, see [Cline setup](./cline-setup.md).

## Claude Code or Codex is installed, but Kanban does not detect it

This usually means the command is available somewhere, but not in the exact environment Kanban inherited when it started.

The easiest fix is to launch Kanban from a shell where the agent command already works. If `claude --help` or `codex --help` fails in that shell, solve that first. Once the command is visible there, Kanban's detection usually falls into place naturally.

This is a common first-use issue on Windows because installation can succeed without the command being immediately available in every terminal session. If needed, close and reopen your terminal after installing the CLI, then test the command again before launching Kanban.

## I approved Git initialization, but project setup still failed

One common reason is that Git itself is installed, but your Git identity has not been configured yet. Kanban's initialization flow creates an initial commit so task worktrees and review diffs have a stable starting point. That commit can fail if Git does not know your name and email.

If that happens, configure Git and then try again:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

This can happen on any platform, but it is especially common on fresh Windows machines and fresh remote servers.

## Windows-specific first-run advice

If you are using Windows and want the smoothest first experience, the safest pattern is:

1. open PowerShell or Windows Terminal
2. verify `node --version` works
3. verify `git --version` works
4. launch `npx kanban`
5. choose the agent path you actually want to use, and if it is Claude Code or Codex, verify that CLI works in that same terminal first

That path avoids most of the environment-detection confusion that can otherwise show up on a brand-new machine.

## A task will not start from the backlog

Kanban can prevent a backlog task from starting if linked task dependencies mean it is still blocked. This is intentional. The board is trying to preserve the dependency order you set up.

If a task looks blocked unexpectedly, inspect its links and the state of the related tasks. A follow-up task may still be waiting for a prerequisite to finish.

## A task starts, but fails immediately

Open the task and look at the live terminal or chat view. Kanban usually surfaces the underlying startup problem there. The most common first-run causes are:

- the agent is selected but not fully authenticated
- the project was not ready for Git/worktree setup
- the external agent command exists in some environments but not the one Kanban inherited

If the failure mentions Cline provider settings, fix them in Settings. If it mentions a missing CLI command, verify the command in the same shell that launched Kanban.

## I still feel stuck

If you have already worked through the checks above, the best next step is to simplify the situation.

Use one small project, choose one supported agent path, and aim for one successful task start before trying linked tasks, auto-commit, custom shortcuts, or advanced setup. Kanban becomes much easier to reason about once you have seen one task move all the way from creation to review.

If you think the product behavior itself is wrong or unclear, please open an issue or share feedback in the Kanban Discord channel linked from the main [README](../README.md).