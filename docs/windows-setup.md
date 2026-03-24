# Windows Setup

This guide is the clearest setup path for people running Kanban on Windows.

The overall product works the same way on every platform: Kanban runs locally in your browser, manages tasks and worktrees, and uses an agent to do the actual coding. The reason to split Windows into its own guide is not that the product is completely different there. It is that Windows users benefit from more explicit instructions about terminals, command availability, and first-run Git setup.

## What you need first

Before you launch Kanban, make sure these basics are in place on your Windows machine:

- Node.js 20 or newer
- Git
- a project folder you want Kanban to use
- one supported agent path: Cline, Claude Code, or OpenAI Codex

The most important practical check is that you can open a terminal and run both:

```powershell
node --version
git --version
```

If either command fails, fix that first before trying to launch Kanban.

## Which terminal should you use?

Use a normal Windows terminal such as **PowerShell** or **Windows Terminal**. The main thing that matters is consistency: if you plan to use Claude Code or Codex, launch Kanban from the same kind of terminal where that CLI already works.

That is important because Kanban inherits the environment of the shell that started it. If an agent command works in one terminal but not another, Kanban will only be able to launch it from the environment where the command is actually available.

## Start Kanban

Open your terminal in the project folder and run:

```powershell
npx kanban
```

Kanban should start a local server and usually open your browser automatically. If it does not, open the local address shown in the terminal output. The default is usually:

```text
http://127.0.0.1:3484
```

If you launched Kanban from the wrong folder or outside your project, that is still okay. Kanban can open first and let you add a project from the interface.

## Choose your agent path

On first launch, Kanban may show a **Get started** dialog. Use that to choose the agent path you actually want.

### If you choose Cline

Cline setup happens inside Kanban. You choose a provider, choose a model, and then sign in or enter an API key. This is often the cleanest first-time setup path because it does not depend on Kanban discovering a separate external CLI command before you can begin.

### If you choose Claude Code or Codex

Those tools are configured outside Kanban. Before you rely on them inside Kanban, make sure the command already works in the same terminal where you are launching Kanban.

For example:

```powershell
claude --help
```

or:

```powershell
codex --help
```

If that command does not work there, Kanban will not be able to launch it either.

## Add or initialize your project

If your project is already a Git repository, Kanban can usually use it right away.

If it is not, Kanban may ask whether you want to initialize Git. That is expected. Kanban uses Git worktrees for tasks, so it needs the project to be under version control.

If you approve initialization, Kanban will create a repository, stage the current files, and make an initial commit. That gives it the stable starting point it needs for task worktrees and review diffs.

If the normal folder picker cannot open, Kanban may ask you to enter the project path manually. On Windows, you can paste the folder path exactly as Windows shows it. You do not need to rewrite it into Unix-style slashes.

## A common Windows-specific failure: Git identity is not configured

On fresh Windows machines, Git is sometimes installed but not fully configured. Kanban's first-time project initialization includes creating an initial commit, and that can fail if Git does not know your name and email.

If that happens, run:

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

Then try adding the project again.

## A common Windows-specific failure: the agent CLI is installed, but not visible here

Another common Windows issue is that a CLI installs successfully, but the current terminal session does not see it yet. If you install Claude Code or Codex and Kanban still cannot detect it, close the terminal, open a fresh one, and test the command again before relaunching Kanban.

This is not a Kanban-specific quirk. It is just a very common Windows command-line first-run issue.

## What success looks like

You know your Windows setup is in good shape when:

- `node` and `git` work in your terminal
- Kanban opens in your browser
- your project appears in the app
- creating a task adds a card to the board
- starting the task opens a working live session instead of failing immediately

Once you get to that point, the rest of the Kanban experience is the same as on other platforms.

## What to read next

Once Kanban is running, the best next documents are:

- [Getting started](./getting-started.md)
- [Choose an agent](./choose-an-agent.md)
- [Cline setup](./cline-setup.md)
- [Troubleshooting](./troubleshooting.md)

If something still goes wrong, especially around CLI detection or Git initialization, the troubleshooting guide is the right next stop.