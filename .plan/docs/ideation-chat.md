The following is a chatgpt session where I discussed my idea for Kanbanana.
Note: This is a historical ideation transcript. References to repo-local `.kanbanana` state are outdated, and runtime state now lives in global `~/.kanbanana`.

# User

Cline was the first ever autonomous coding agent extension for VS Code, and shortly after I made it, a lot of people copied it. Cursor and Windsurf and Claude Code and everyone else made their own agent. Eventually Claude Code made a terminal-based agent, a CLI, and then all of a sudden everybody got hopped on to that trend where Gemini had a CLI and OpenAI made a CLI with Codex. All these model labs stopped just doing model development; they also started competing with Cursor and Cline, where they made their own agents because it was so easy for the terminal.

The thing is, based on what the best model is, people will jump between these tools and jump between subscriptions. The situation is that Anthropic and OpenAI are giving away subscriptions where, let's say, $200 for the max plan. If you were to use the same usage, direct API cost would be like $3,000 plus dollars. People are just incentivized to use the Anthropic subscription and the Anthropic product to use their model, and it sort of prices out competition like Cline and Cursor.

And so I came up with this idea where I personally have all these agents installed on my computer: all these CLI agents.
- Gemini CLI for run Gemini is the best model
- Codec CLI for when GPT is the best model
- Claude Code CLI for when Claude is the best model


I switch between these right now, switch between subscriptions depending on what the best model is. It's always between Gemini and GPT and Claude, and the reality is they're always going to compete, always going to one up each other, right?

My idea is to create an abstraction on top of it. Now these agents are so good. Before, when they're in the terminal, you give the agent a task and you have to monitor its output and steer it. You have to steer it right, what is it reading? What is it making? You have to steer it right, but then a couple of weeks ago GPT-5.3 Codex came out, and this model is so good. It almost never needs course correcting; you tell it what to do and it figures it out. It feels very, very intelligent. This feels different, and it just always kind of figures out and does it really well rather than I could ever do it.

Now it's less about me course correcting it, and I feel like I'm the bottleneck. I give it the task, or you're the issue to fix, or I get something, but then I'm kind of waiting for it to finish and see the end result. I look at the diff, I make a commit or a PR, and it's done, right? I feel like now I have four terminal tabs open and kind of doing this, but even that just feels like I could be doing so much more.

I'm thinking, what's next? Right now it's a terminal, but what is next? Even that the terminal is kind of getting outdated now too, because you don't really need to see what the agent is doing.

Here's my idea. I just bought a domain, kanbanana.ai. I reserved npm kanbanana. I got kanbanana Reddit, kanbanana Discord. Now I'm thinking about making an npm package CLI where you run kanbanana in your terminal. It launches the browser with a website, so essentially it creates a web server, and this webpage is a GUI to managing your agents. You have the backlog that you can add to. When you add to it, you can attach a GitHub issue or GitHub PR or a linear ticket or something else as context. We can create those integrations directly right there. We can use the existing GH tool if it's installed for that. The user doesn't have to set extra stuff up, because it's already locally, right? It's all this; the CLI is running locally. It's like a web server and can take advantage of having access to the user's computer.

Here is a to-do column. Here's where you take the tickets that you create from backlog, you put into to-do, and then you have an in-progress column. Here, if you move the ticket from to-do to in-progress, then the agent starts working on it. You see real-time live output about what's going on. You can click on the card to open it up and interact with it if you need to. It will send you alerts, notifications, like Chrome notifications when the agent needs your attention. It'll be like flashing the card; it will be flashing that needs you to respond to it. You can then see its progress, and when it's completed, it'll go to a ready for review column. Here you can review a diff, its output. You click on it and can see the diff. You can see the change that was made and its explanation, and then you can decide to give it feedback to continue doing work.

If you type in the chat field, it continues working, and then it goes back into the in-progress column. You can commit or create pull requests from them. Of course, this uses the GH tool. It's installed. With commit, you could just use get, and with the create pull request, that probably wants to use the AI to do as well. I guess it would be something to create the pull request. Might I typically ask the agent to create the pull request? Right? Not sure you want to do something like that. I'm not sure what kind of thing through that, but maybe other options too, if it's not commit and create pull requests. Maybe we could add other options too. Additional options. Once you've committed or created a request, then the card is automatically moved to the finished column.

You can just keep track of all the tasks you're doing and keep track of what's in progress. You can continuously add to the backlog as you come up with ideas and the work. I feel like this kind of lets you move faster and parallelize more. This, to me, feels like the right design pattern. I think that's what I nailed with Cline; I found a really good design pattern for where things are at. This feels like where things are at now because of GPT 5.3 codex, where I don't really need to steer anymore. Now it's more about, "OK, what's all the work that needs to get done? Let's just do it." This feels like the right UX.

I know there's this ACP agent protocol where the CLI agents all conform to this shared protocol, where you can see what it's doing and interact with it. I think we use something like that, but I think a nice GUI and a web page and a browser that gets launched from npx kanbanana. I think that's a really compelling thing, right? Then we create a billboard in npx kanbanana, like npx kanbanana, like anyone with a terminal can launch that. Right? I think that's so powerful. And then there's this other detail about it that I think is interesting. You can have a billing management page, except it's to manage your CLIs. For people that have the Gemini CLI and the Claude Code CLI and the GPT CLI, we just provide easy buttons or somehow show them their usage. We can show them their remaining usage. There are open source projects that show you your remaining usage for these agents. We could just pull something like that and show you your remaining usage in Claude Code if that's what you're using. We could also have links to easily cancel your subscription or easily resume your subscription so that when there's a new good model, you can just very easily switch. Literally a page that makes switching cost basically zero, and for you to really see the usage in front of you, because the reality is a lot of people are very cost conscious when it comes to this stuff. These tokens add up, especially if you just do direct API; that's just not affordable anymore. These model labs are subsidizing so much to drive more usage to their models. We should really take advantage of that here.

That's not really the main concept, without deciding that it's an interesting idea and kind of in the vein of this: "You know what? This is where things are at, right? Model labs are subsidizing. They're making the best agents for their models. The best model keeps changing. People want to switch and use the best thing. Let's provide a really good abstraction for all that, for where things are at, for what these agents are capable of doing for unlocking people to do more work." Okay? 

# AI Assistant

## The Core Insight

You're seeing something clearly: the agent layer is commoditizing. Claude Code, Gemini CLI, Codex CLI — they're all converging on "give it a task, it figures it out." GPT-5.3 Codex crossed a threshold where you stopped being a copilot and started being a task dispatcher. The bottleneck shifted from "steering the agent" to "feeding the agent work." That's a fundamental UX shift, and nobody has built the right interface for it yet.

Kanbanana is that interface. It's not another agent — it's the orchestration layer on top of all of them.

## What I Think Is Really Smart Here

**The npx entry point is genius.** Zero install friction. Anyone with Node can run `npx kanbanana` and get a full GUI in their browser. That's the kind of thing that spreads on Twitter/Reddit overnight. It's the same magic that made `npx create-react-app` iconic — one command, immediate value.

**Treating CLI agents as interchangeable backends** is the right bet. You're not competing with Anthropic or OpenAI on the agent — you're sitting above them. When the best model changes (and it always does), Kanbanana doesn't care. That's the whole point.

**The subscription/usage management page** is sneakily brilliant. It sounds like a feature, but it's actually a retention mechanism. You're making Kanbanana the place people go to understand their AI spending. Once they're checking usage there, they're living in your tool.

## A Few Things Worth Discussing Before We Spec This Out

**1. Agent protocol integration.** You mentioned ACP. The question is whether to build a tight integration with each CLI (Claude Code, Gemini CLI, Codex CLI) via their specific interfaces, or to build against ACP and hope they all converge. My instinct: start with direct integrations for the big three since that's what people actually use today, and add ACP support as a forward-looking option. What's your thinking?

**2. Concurrency model.** When someone drags three tickets to in-progress, are you spawning three separate CLI processes? That's the simplest approach and probably right for v1 — each card maps to a subprocess running the selected agent in a working directory. But worth being explicit about.

**3. Git workflow.** You mentioned commit and create PR. I think the flow should be: agent finishes → card moves to "Ready for Review" → user sees the diff inline → user can either approve (commit/PR) or send feedback (card goes back to in-progress). For the PR creation, you're right that the agent should probably draft the PR description, but the actual `gh pr create` can be a simple subprocess call. The user just needs to confirm title/description.

**4. What repo context does each task get?** When a card moves to in-progress, does the agent get the full repo? A branch? Does Kanbanana auto-create a branch per task? I'd suggest auto-branching per task — it keeps parallel work from colliding and makes the PR flow natural.

**5. The billing/usage page scope.** For v1, do you want to actually pull live usage data from each provider's API, or start simpler — like showing links to each provider's dashboard and subscription management? The live usage data would be amazing but each provider's API for that is different and some might not even expose it well.

# User

the vision is parallelism of many tasks. We can use the concept of work trees to have a dedicated directory for each task card. Since most people typically have I get ignore for the files that they don't want to check, because they have a lot of, it could be like node modules. It could be big, right? We actually want to have those in the work tree as well. An interesting concept that I've actually seen is to just do a symlink of the original work trees' get ignored files and the new work trees that you create. See, this is kind of a very opinionated workflow. I think that's the point with Canbanana: we want to be opinionated about this stuff and just make it really simple for the end user to just get work done.

We can describe this philosophy that we can have, like a nice little philosophy pop-up card type thing where we describe, "Look, this is really opinionated, but this is what helps me get work done fast, and symlinks are a secret sauce to work trees, basically." I'm not really seeing anybody else do this right now.

# AI Assistant

Each task card gets its own git worktree, which means its own branch and its own directory on disk. The agent runs in that isolated directory, so you can have five tasks in-progress simultaneously without any conflicts. The symlink trick for `.gitignore`d files (node_modules, build artifacts, .env files, etc.) is clever — you avoid duplicating gigabytes of dependencies across worktrees while keeping each one fully functional. The agent can just run the code, run tests, everything works.

And yeah, I don't think anyone else is doing this either. Most people using worktrees are doing it manually and re-running `npm install` in each one, which is painful. Automating the symlink setup as part of card creation is a real quality-of-life win.

The opinionated philosophy angle is strong too. That's what made Cline work — you had a clear opinion about how AI-assisted coding should feel, and you built exactly that. Kanbanana should have the same energy: "Here's how parallel AI-driven development should work. We've thought about it so you don't have to."

# User

So another thing is we want to have some sort of state persistence. I'm thinking of a global kanbanana directory where we store information about the user sessions and stuff.

Depending on where you start Kanbanana, if you're in a project, in a repository, you start Kanbanana from there, then that is considered the main Worktree. Or I guess we could just look at Git and see what the main Worktree is, and then that's the project, right? You see the tasks for that project only, not all your projects but that project. We can actually have a toggle for all or this repository, right? If it's all, then you see all your repositories for the task. If it's just a repository, then it's where you started Campnano, and then you have an option to go to a different directory or something to see the tasks there. Basically there's some kind of persistence about the tasks you do.

That's one detail I think about. It's not like Local and just Computer, and then, um And look, we're not trying to replace the CLI agents. No. If you want to resume your session for these cards, we can actually have a command at the bottom of the card. Hey, you can resume the session in your terminal if you want and use it how you typically would. It's just an interface, right? We just want to make it really seamless for people.

I kick off a bunch of agents at the same time and manage them easily. It just feels like the right abstraction. It's not a replacement for the CLI agents because I recognize that sometimes I just want to be in the terminal. That makes a lot of sense sometimes, but for when I want to get a lot of work done, this makes more sense.

Reality is, we also have to make it look and feel really well-designed. When the task is done, you see a Diff View. The Diff Views have to be phenomenal because the Diff is what you're looking at. You have a way to get feedback on the Diff stuff like that. What are some other things? Let's think through this: what else do we do here? What else do we need to think about and think through? What is next?

# AI Assistant

## What's Solid

The state model is clear: `~/.kanbanana` for global config/state, and per-repo state tied to the git root. The toggle between "this repo" and "all repos" is a nice touch — it means Kanbanana scales from "I'm focused on one project" to "I'm managing work across everything." The worktree-per-task with symlinked gitignored files gives you safe parallelism. The "resume in terminal" escape hatch is smart positioning — you're not trying to own the agent, you're just a better way to dispatch and review.

## Things We Should Think Through

**Agent selection per task.** When someone creates a card, do they pick which CLI agent runs it? Like a dropdown — Claude Code, Gemini CLI, Codex CLI? Or does Kanbanana pick for them? I think for v1, explicit selection is better. Maybe a default agent setting in config, with per-card override. Eventually you could get smart about routing, but that's later.

**Error handling and stuck agents.** What happens when an agent errors out, hits a rate limit, or gets stuck in a loop? The card should probably move to a "Needs Attention" state with the error visible. The Chrome notification you mentioned earlier covers alerting. But we should also think about a timeout or token budget per task — some way for the user to set guardrails.

**The diff view.** You're right that this is the most important UI surface. When a card hits "Ready for Review," the user needs to see a GitHub-quality diff — file tree on the left, inline diff on the right, ability to expand context, maybe even inline commenting to send feedback back to the agent. This is where people will spend the most time, so it has to be excellent. We should look at something like `diff2html` or build on Monaco's diff editor for this.

**Task context and instructions.** When someone creates a card, what do they fill in? I'm thinking: a title, a description/instructions field (markdown), and then optional attachments — a GitHub issue URL, a Linear ticket URL, a PR URL, or just file paths. The agent gets all of this as its prompt context when the card moves to in-progress. Should there also be a way to attach a "system prompt" or rules file per-project? Like a `.kanbanana/rules.md` that every task in that repo gets?

**Multi-repo tasks.** You mentioned the "all repos" view. Can a single task span multiple repos, or is each card always scoped to one repo? I'd say one repo per card for v1 — keeps worktree management simple.

**Auth and CLI detection.** On first run, Kanbanana needs to detect which CLI agents are installed and whether they're authenticated. A quick setup/status page that shows "Claude Code ✓ authenticated, Gemini CLI ✓ authenticated, Codex CLI ✗ not found" would reduce friction. For the subscription/usage page, this same detection feeds into what we can show.

**The philosophy card.** I like the idea of a first-run experience that explains the opinionated choices — worktrees, symlinks, branch-per-task. Maybe a dismissable onboarding card that lives in the backlog column on first launch: "Welcome to Kanbanana. Here's how we think about parallel development..." Brief, confident, not preachy.

# User

Okay, I just thought of a really cool feature. When you create a task in the backlog, in To Do, you can have an option to essentially run this task with multiple Cline agents: kick it off with Claude and kick it off with Codex and have them both work on the same thing at the same time. Then you can see which one is better and just take the one that's better. Or you can open up a new task where you can use other tasks as context. Not only can you use GitHub issues or pull requests or linear tickets as context, but you can also use other tasks as context. This is incredibly powerful.

Now this unlocks kind of multitask orchestration. Typically, when you're working on a bunch of stuff, you might want to give context, like the work that's done, to the next task. Hey, we just did this; this is next, something like that, right? That makes a lot of sense, this sense of continuity, and back to this multi-model, this model bake-off sort of concept. You can create new tasks that use the other two tasks as context and say these two tasks pick the best one or pick the best from both of them, something like that. That's another really big, compelling feature here: using tasks as context.

Under the hood, we're just setting the model. Here's a work tree, here's working changes, and we'll pull some of the user messages out of that task. We can use ACP to pull the user-sent messages in that task, because that's likely what gives the most signal about what the users are trying to accomplish in that task, what they tried to accomplish, not tasks, right? That's powerful, that's very powerful.

# AI Assistant

**1. Multi-agent races.** Same task, multiple agents, pick the winner. This is the most immediately compelling one. You create a task, check off "run with Claude Code and Codex," and Kanbanana spins up two worktrees, two branches, two agent processes. Both cards show up side-by-side (or maybe as sub-cards under a parent task). When both finish, you see both diffs and pick the better one. The losing worktree gets cleaned up. This alone is a headline feature — nobody else lets you do this easily.

**2. Tasks as context.** When creating a new task, you can reference other completed (or in-progress) tasks. Under the hood, you're pulling the user messages from those tasks (via ACP or just from your own session logs) plus the resulting diff/changes. This gives the next agent continuity — "here's what was just done, now do this next thing." This is how you get sequential workflow chains without the user having to copy-paste context around.

**3. Synthesis tasks.** A special case of tasks-as-context where the job is explicitly "look at these two competing implementations and produce the best version." This is the natural follow-up to a multi-agent race when neither solution is clearly better — instead of picking one, you create a new task that takes both as input.

The context model is clean: a task's context is a list of references, and each reference is one of — a GitHub issue, a GitHub PR, a Linear ticket, a file path, or another Kanbanana task. When it's another task, you resolve it to the user messages plus the working changes from that task's worktree. The agent gets all of this assembled into its prompt.

**Tech stack:** TypeScript for the CLI and backend server, React for the frontend UI, served locally from the same process. Sound right?

**v1 scope:** The kanban board (backlog → to-do → in-progress → ready for review → done), worktree management with symlinks, multi-agent races, tasks-as-context, diff view, commit/PR creation, Chrome notifications, agent detection/status page, the philosophy onboarding card, and the subscription/usage management page. Does that feel right, or do you want to cut or add anything for v1?

# User

OK, so back to when you were asking questions before. Let's just start with integrations with the big three for ACP. When someone creates a card, it's its own CLI process.

About the title and the description for the PR draft, I'm not sure. I just realized something. We can actually just create our own little. Oh wow, you know what we could do? We could actually use a CLI agent in a headless sort of way, where we call it with a task like Claude: "create PR title and description and JSON format with this output." Then once we get the standard out of that command, we use that to fill it out. Actually, we can do that in other places as well, not just for this PR title and description creation. That's such a nice little feature, like easy PR creation; basically, you just hit a button and it creates a really nice PR. We can actually detect, I think we can use the GH tool to detect if it's a PR or not. If currently, let's say, the user in the card said "create a PR out of it," we could detect, "Oh, it's a PR?" Then automatically move to done or something. I don't know, maybe the user can prompt it to create a PR instead of them having to hit a button, and we kind of just do it our own way. I'm not sure; help me think through this. I'm thinking an interesting idea here is that we can actually use these CLI agents to just do stuff like that for us, create PR title and description for us. Anyways, it might be worth making that its own little module where we can utilize that in other ways throughout the application as well.

Then what repo context does each task get? We auto create a work tree, which will give the user options. Basically, when they create a task, they'll get a little dropdown: "Do they want to do the work locally? Do they want to do it in a new work tree?" If they select new work tree, then they'll be able to select a branch to work tree off of, and we won't create a branch. Now here's the interesting thing: I don't want to be creating a branch for each work tree, because that can just pollute and get a bunch of branches. What I want to be doing is to just check out the commit. It's like, in this branch list, the head is at the commit (I forget what that's called). When you move a task to done, we do automatic work tree cleanup. We delete the directory. We save your storage. That's another big feature where this is really an abstraction of work trees that just makes sense. You don't have to mess with any of it yourself; we can handle it based on where the task is in the Kanban board.

Then about the billing usage page, I was thinking we don't pull live usage yet. Don't worry about speccing this part out exactly. Because we'll need to do a little bit of R&D; in other projects that have figured this out, where they can look at the local CLI. They can pull usage data out of it via the CLI and explain it to the user. I think that would just be helpful, just in general, for the user to know, "OK, how much usage data I've left." Just in the vein of really making it easy to switch between agents and manage your usage of these subsidized plans and get the most out of them, this page will be helpful there.

# AI Assistant

**The headless agent utility module** is a great idea. You're essentially saying: we already have these powerful CLI agents available, so let's use them as a general-purpose AI utility throughout the app. PR title/description generation is the first use case, but you could use this same pattern for things like auto-generating task descriptions from a GitHub issue URL, summarizing a diff for the review card, or even suggesting how to break a large task into subtasks. A small module that takes a prompt, runs it through whichever agent is available (headless, short-lived), and returns the output. That's reusable everywhere.

**On the PR flow**, here's how I'd think about it. There are really two paths:

The first path is user-initiated. The agent finishes its coding work, the card moves to "Ready for Review," the user looks at the diff, and hits a "Create PR" button. Behind the scenes, the headless agent module generates a title and description from the diff and task context, then `gh pr create` runs with that. The user gets a quick preview/edit before it submits. Clean, predictable.

The second path is agent-initiated. The user's original task instructions say something like "fix the bug and create a PR." The agent itself runs `gh pr create` as part of its work. Kanbanana detects this happened — either by watching the agent's output for `gh pr create` or by checking if a PR exists for that branch after the agent finishes. If a PR was created, the card can auto-advance to done (or at least surface it: "PR created → link"). 

I think you support both paths. The detection piece for the agent-initiated path is the interesting part. You could poll `gh pr list --head <branch>` when a task completes to check if a PR exists. If yes, show it on the card and optionally auto-advance. That way you're not trying to parse agent output — you're just checking the actual state of the repo.

**On the worktree model**, I like the detached HEAD approach. So the flow is: user picks a branch to base off of, Kanbanana resolves the HEAD commit of that branch, creates a worktree checked out at that commit (detached HEAD, no new branch created). The agent works in that directory. If the user wants to commit or create a PR, *that's* when a branch gets created — only when needed. And when the task moves to done, the worktree directory gets cleaned up. No branch pollution, no orphaned directories.

For the "local vs worktree" option on task creation — that's smart. "Local" means the agent just runs in the main repo directory (for quick one-off tasks where isolation isn't needed), and "new worktree" gives you the full isolated setup. Default to worktree for safety, but let power users opt into local when they know what they're doing.

I think we're ready. Let me write the full spec. I'll include everything we've discussed — the kanban workflow, worktree management, multi-agent races, tasks-as-context, the headless agent utility, PR flows, diff view, notifications, agent detection, the philosophy onboarding, and a placeholder section for the billing/usage page that notes it needs R&D. I'll frame it as a prompt you can hand directly to a coding agent.

# User

So we can just commit on top of the detached head. Or I guess we would want to create a branch. No, we can actually, I think, what this looks like is we commit on a detached head. If they want to create a PR, then we create a branch. If they just want to commit, they just hit the commit button, then we just cherry pick the commits on to the main branch, or the branch they branch off of. I don't think we need to create a branch every time, basically.

I also think it's important that we do not automatically move a card from ready for view to done, because that will delete the work tree automatically. What we need to do is the user will need to move it to done themselves. Maybe when they hit the commit or create pull request button, that button grays out and gives some indication that, "OK, you know, completed moving to done to delete the work tree and clean up everything."

We also have maybe somewhere in the UI some way to track all your work trees, so we can easily track all your work trees and the branch and be able to easily delete them at the open port as well. The more I think about this, I realize, OK, this is an abstraction over work trees, over CLI agents, over all that, in a way that really lets you parallelize. At this point, the CLI agents are getting commoditized. The CLI agents are just a very thin wrapper around the models themselves. You're paying for the model via the CLI agent, and Kanbanana gives you that abstraction over all of it, this multi-CLI orchestration layer.

In reality, most people won't be using multiple CLIs. Most people will be using just one of them, so we don't have to lean in too hard into this idea of one CLI versus another CLI bake-off thing. I don't think they're going to use a different CLI for different types of tasks, basically, but it's important that we support it, because they'll switch between a lot, right? I think there's going to be a lot of research we have to do into things like ACP to really nail this.

What else? Be my thought partner in this. What else am I missing? What else is going to make this magical? There's a developer I really respect who said that the best ideas feel a little bit like sci-fi. Let's make this magical.

# AI Assistant

Okay, let me think about what makes this feel like sci-fi rather than just "a nice project management UI for agents."

**The magic moment you're describing is:** I sit down, I have 20 things to do, I drag them all to in-progress, and ten agents spin up simultaneously across ten worktrees, all working in parallel, and I just watch cards flow across the board. That's already pretty magical. But here's what could push it further:

**Live activity feed.** Instead of just seeing cards in columns, imagine a subtle real-time pulse across the board. Each in-progress card shows a one-line status that updates — "reading src/api/auth.ts" … "writing tests" … "running npm test" — just enough to feel alive without being noisy. It makes the whole board feel like a living system. You glance at it and you can see ten agents working simultaneously. That's the sci-fi moment. It's like a mission control dashboard.

**Smart task decomposition.** You paste in a big GitHub issue or just type "refactor the auth system to use OAuth2." Before it goes to in-progress, you can hit a button that says "break this down" — and the headless agent module analyzes the task and suggests splitting it into three or four sub-tasks, each as its own card, with dependencies marked. You approve, and suddenly four cards appear in your to-do column, ready to be parallelized. The user goes from one vague idea to four concurrent agents in two clicks.

**Dependency chains.** If task B depends on task A, you can link them. When A moves to done, B automatically inherits A's changes (cherry-picked onto its worktree) and starts. You set up a whole pipeline of work and just let it flow. This pairs naturally with task decomposition — break down a big task, mark the dependencies, drag the first one to in-progress, and the rest cascade automatically.

**The "what should I work on" moment.** You open Kanbanana in the morning. It connects to your GitHub issues, your Linear board, maybe even your PR review queue. It surfaces: "You have 3 issues assigned to you, 2 PRs waiting for review, and 1 failing CI pipeline." One click to turn any of those into a task card. You're not context-switching between GitHub, Linear, and your terminal — Kanbanana is the single pane of glass for your dev work. That's the dream.

**Session continuity across devices.** Since the state lives in `~/.kanbanana` and per-repo, imagine if you could `npx kanbanana` on your laptop, start some tasks, close it, then `npx kanbanana` on your desktop and everything is right where you left it. The agents might not be running anymore, but the board state, the worktrees, the diffs — all there. You just resume. For v1 this is mostly free since it's all local filesystem state, but it's worth designing the state model with this in mind.

Now, one thing I want to push back on slightly. You said most people will just use one CLI. I think that's true *today*, but I think the switching behavior is the real insight. People don't use multiple CLIs simultaneously — they switch their *default* every few weeks as models leapfrog each other. Kanbanana should make that switch feel like changing a dropdown, not reconfiguring your whole workflow. So the multi-CLI support isn't about bake-offs as the primary use case — it's about making the switching cost zero. The bake-off feature is the flashy demo, but the real value is that when Gemini 3.0 drops next month, you just change your default agent and everything else stays the same. Your board, your worktrees, your workflow — none of it changes.

**One more thought on the worktree management view.** I think this should feel like a resource monitor. Show all active worktrees, their disk usage (especially with symlinks, it'd be cool to show "actual size: 50MB, saved via symlinks: 2.3GB"), which task they're tied to, and one-click cleanup. Make people feel like Kanbanana is being a good steward of their disk space. That's a small thing that builds a lot of trust.

What resonates? I think the dependency chains and task decomposition might be the features that take this from "useful tool" to "I can't go back to working without this." Should I start writing the spec now, or do you want to keep riffing?

# User

Those are all incredible ideas. The smart task decomposition is interesting. I guess what that kind of looks like is when you're creating a task, there's a button that says "decompose" or "break down into subtasks". When the user hits that, it essentially moves the task into "in progress". The agent is given a prompt to output in that structured output, right? This isn't in headless mode, I guess, or I'm not sure. Well, I guess it's all kind of headless, but we prompt it to output in JSON format with the tasks and the dependency chain and whatever else we need. Once it's completed, then that card gets a button where you can create tasks or something. You watch as that card animates, where cards stack up underneath it and fan out to the to-do column. You can see the dependency chain via arrows, and it should look like the dependency arrows on the board.

I love the dependency chain idea. I think that is such a cool automation, where if it's in the to-do thing and there's a dependency chain attached to it, it will automatically bring it into "in progress" when the dependency is done, right? I'm also realizing just another detail. The CLI agents take a certain command to be able to run essentially YOLO mode, like Claude Code has a dangerously skip permissions flag that lets it just run to completion.

# AI Assistant

Kanbanana is a *dispatch and review* tool, not a *steering* tool. That's the whole point — you've crossed the threshold where these agents are good enough to just go. If you want to steer, use the CLI directly. If you want to parallelize and manage, use Kanbanana.

That said, I think there's a middle ground worth preserving. The agent runs in full auto mode, but if it hits something truly blocking — like it needs credentials, or it's genuinely confused about requirements — the card should surface that. Not as an interactive chat, but as a notification: "This task is stuck. Here's what the agent said. You can provide input or retry." The user types a response, the agent gets it appended to its context, and it resumes in full auto mode again. It's not a conversation — it's a one-shot course correction. That preserves the "fire and forget" feel while handling the edge cases.

On the task decomposition UX, I love the animation concept. The visual of cards fanning out from a parent card into the to-do column with dependency arrows is genuinely compelling — it makes the abstract concept of "break this into subtasks" feel tangible. And you're right, this is just another use of the headless agent utility. The prompt would be something like: "Given this task description and the repo structure, break this into independent subtasks. Output JSON with task title, description, and dependency list." The agent explores the codebase in auto mode, figures out the right breakdown, and returns structured output.

For the dependency arrows on the board, I'm imagining thin lines connecting cards across columns. When a dependency completes and the next card auto-moves to in-progress, the arrow could animate — a pulse traveling along it. Small touch, but it reinforces that feeling of a system in motion.

I think we've got a really complete picture now. Let me write the spec. Here's what I'm going to structure it as:

The document will cover the project overview and philosophy, the architecture (CLI entry point, local web server, React frontend, state management), the core kanban workflow with all the column states and transitions, the worktree management system with symlink optimization, the agent integration layer for all three CLIs with auto-mode flags, the headless agent utility module, the task model including context references and dependency chains, the task decomposition feature, the multi-agent race feature, the diff review experience, the commit and PR flows, notifications, the agent detection and status page, the worktree resource monitor, the billing and usage placeholder, and the onboarding philosophy card.

# User

Also, there's gotta be keyboard shortcuts, kind of like how linear has keyboard shortcuts for stuff:
- Keyboard shortcut for creating a new task
- Keyboard shortcut using arrows to switch between them
- Keyboard shortcut to search for a task and easily focus on it


You, I don't know, command spacebar or something, maybe not that command K, and then you start typing and it will highlight the card. You can hit enter and it opens it, then escape to close it.

One thing I really like that we should add is a script shortcut button. Essentially, you can have a button at the top somewhere where you can configure, let's say, a run button. You could select an icon from a collection of icons that might allow a play icon, and you title it run, and then you have an input field where you can just type out the bash that it executes.

The point is that it runs something, it runs some commands that would then "run the application". There could be other sorts of things here too, like a test shortcut button. What this would do is maybe open up a little preview of the command output under the button or something. I'm not sure exactly what that looks like.

These buttons, these shortcuts you set up would save this for a configuration file in the project itself. Before we talked about having a global home directory level can banana, but in this case, since it's tied to a project, it would be project level. You would have a doc camp banana in your repository with this configuration file for these shortcuts, and you could then come in and share with your team. I think that's really cool to have something like that too. Wonder if there are other things we would put here that are at the project level, that are kind of worth sharing with your team, essentially that use can banana.
