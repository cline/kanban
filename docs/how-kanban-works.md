# How Kanban Works

Kanban is easiest to understand when you stop thinking of it as “a chat app with cards” and start thinking of it as “a task board that runs agents in isolated coding workspaces.”

The board is there to organize work. The agent is there to do the work. The review flow is there to help you decide what should actually ship.

## The board

Each card on the board is a task. A task is just a prompt plus some workflow settings, such as the branch it should work from and whether it should automatically commit or open a pull request later.

The columns tell you where the task is in its lifecycle. A task begins in the backlog, moves into active work when it starts, lands in review when it is ready for you to inspect, and can be moved to trash when you are done with it or want it out of the way.

The board is not just visual decoration. It is the control surface for how work moves through the system.

## The worktree

The word “worktree” sounds technical, but the practical idea is simple: every task gets its own isolated copy of your repository state.

That matters because it lets multiple agents work at the same time without constantly overwriting one another's files. One task can change the login page while another task writes tests and a third task refactors a utility file. Kanban keeps those efforts separated until you review and merge the results.

You do not need to manage those worktrees manually. Kanban creates them, tracks them, and cleans them up.

## Starting work

When you press play on a task, Kanban prepares the task workspace, starts the selected agent in the right place, and begins streaming progress back to the board.

If you are using Cline, you will see Kanban's native Cline chat experience. If you are using Claude Code or Codex, you will see a terminal-backed session. Either way, the core workflow is the same: the task works in its own isolated workspace and Kanban keeps you informed about what is happening.

## Reviewing work

Kanban is built around the idea that agent work should be reviewed as code changes, not just accepted as conversation. When a task is ready, you can open it and inspect the diff produced in that task's worktree.

This is one of the product's most important ideas. You are not only reading what the agent says it did. You are reading the actual file changes.

Kanban also lets you leave review comments tied to the diff. That means the handoff back to the agent can be grounded in specific code, much like a pull request review.

## Linking tasks

Some work is naturally sequential. You may want one task to finish before another begins. Kanban supports this through task links.

Linked tasks can be used to build dependency chains so the board understands that some work should wait for earlier work to complete. This keeps large changes from turning into one giant task and makes it easier to automate a longer sequence safely.

The important idea is not the exact link mechanics. It is that Kanban gives you a way to represent “do this after that” as part of the board itself.

## Trash and restore

Moving a task to trash does not mean Kanban forgets everything about it forever. Trash is a cleanup and organization tool. It lets you remove finished or paused work from the main flow while preserving the task record.

Kanban also keeps track of worktree state so tasks can be restored later. In normal use, this makes the board feel less fragile. You can clean things up without feeling like every move is irreversible.

## Commit and Open PR

When a task is ready, Kanban can hand the final shipping step back to the agent through **Commit** or **Open PR**. The important detail is that this still happens in the context of the task's isolated worktree and the branch you chose as the base.

That means the workflow stays consistent: agents do work in isolated spaces, you review the result, and then Kanban helps move the accepted result back into your main Git flow.

## Script shortcuts

Kanban also has project-level script shortcuts for commands you run often, such as `npm run dev`, `npm test`, or a local build command. These are not required for Kanban itself, but they make day-to-day use much smoother because you do not have to retype the same command every time you want to test or inspect your app.

## The big picture

Kanban is not trying to replace Git, and it is not only trying to wrap an agent terminal in a nicer shell. Its real job is to turn agent work into a workflow that is easier to parallelize, inspect, review, and ship.

Once you understand those pieces — tasks, isolated worktrees, reviewable diffs, and optional task links — the rest of the product starts to feel much more natural.