# Getting Started

This guide is for first-time users who want the shortest path from opening Kanban to successfully starting a task.

If you are on **Windows**, use the dedicated [Windows setup guide](./windows-setup.md) first. The rest of this page is written primarily for the general local setup flow, which is usually clearest for macOS and Linux users.

The easiest way to think about Kanban is this: Kanban organizes the work, and an agent does the coding. Kanban itself runs locally in your browser. The agent runs either through Kanban's built-in Cline integration or through an external CLI such as Claude Code or Codex.

## Before you begin

Kanban is meant to run on your own machine. In practice, that means you should have Node.js 20 or newer and Git installed. Kanban also needs a project folder. That project can already be a Git repository, or it can simply be a normal folder that Kanban helps you initialize.

You also need one agent path. Today, the launch-supported choices are Cline, Claude Code, and OpenAI Codex.

If you want the fewest moving parts inside Kanban, start with **Cline**. Cline is built into Kanban's native runtime path, so you do not need a separate `cline` command just to use it here. If you already work in Claude Code or Codex and want Kanban to sit on top of your existing setup, choose one of those instead.

## Start Kanban

Open a terminal in your project folder and run:

```bash
npx kanban
```

Kanban starts a local web app. In most cases it opens your browser automatically. If it does not, open the local address printed in the terminal. The default address is usually `http://127.0.0.1:3484`.

If you launched Kanban from somewhere that is not your project, that is still okay. Kanban can open first and let you add a project from the interface.

## Pick your agent path

On first launch, Kanban may show a **Get started** dialog. This is where most new users should make their initial choice.

If you choose **Cline**, Kanban will ask you to select a provider and model, then sign in or enter an API key. This setup happens inside Kanban.

If you choose **Claude Code** or **Codex**, Kanban expects that setup to have already happened outside Kanban. In practical terms, that means the `claude` or `codex` command should already work in the same terminal environment you used to launch Kanban. If Kanban does not detect the command, see the [troubleshooting guide](./troubleshooting.md).

If you are unsure, choose Cline first. It is the most self-contained starting point.

## Add or open a project

If you launched Kanban in the root of a repository, your project should usually appear right away. If not, click **Add project** and choose the folder you want Kanban to use.

If the folder is not already a Git repository, Kanban may ask whether you want to initialize Git. This is not just a nice extra. Kanban uses Git worktrees so tasks can run in isolation, and that requires the project to be under Git.

If you approve Git initialization, Kanban will:

1. run `git init`
2. stage the current contents of the folder
3. create an initial commit

That behavior is intentional. It gives Kanban a safe baseline for worktrees and review diffs. If you are not ready to put that folder under version control yet, cancel and come back after you prepare the project yourself.

## Create your first task

Once a project is open, create a task card with a short, concrete prompt. Good first prompts sound like normal ticket language: “Add a loading state to the settings page,” “Fix the broken login redirect,” or “Write tests for the branch picker.”

When you press play, Kanban creates a dedicated worktree for that task and launches the selected agent inside it. That is the core experience: each task works in its own isolated checkout so multiple tasks can run without colliding.

If you are using Cline, the task opens into Kanban's native chat-driven runtime. If you are using Claude Code or Codex, Kanban opens a terminal-backed session. In both cases, the board updates as the task progresses.

## What success looks like

You know setup is working when all of the following are true:

- your project is visible in the sidebar
- creating a task adds a card to the board
- starting the task moves it into active work rather than failing immediately
- opening the task shows either a live terminal or a live Cline chat surface
- the task eventually produces a diff you can review

If you get that far, the rest of Kanban becomes much easier to learn. From there you can leave review comments, restore tasks from trash, commit finished work, or link tasks into dependency chains.

## What to learn next

If you want help choosing between Cline, Claude Code, and Codex, read [Choose an agent](./choose-an-agent.md).

If you are on Windows and have not gone through the platform-specific instructions yet, read [Windows setup](./windows-setup.md).

If you chose Cline and want a fuller explanation of providers, models, and sign-in, read [Cline setup](./cline-setup.md).

If something does not work, especially during first launch, go straight to [Troubleshooting](./troubleshooting.md).