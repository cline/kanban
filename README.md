## npx kanban (Research Preview)

<p align="center">
  <img src="https://github.com/user-attachments/assets/2aa3dcc7-94e3-4076-bcfe-6d0272007cfe" width="100%" />
</p>

A replacement for your IDE better suited for running many agents in parallel and reviewing diffs. Each task card gets its own terminal and worktree, all handled for you automatically. Enable auto-commit and link cards together to create dependency chains that complete large amounts of work autonomously.

> [!WARNING]
> Kanban is a research preview and uses experimental features of CLI agents like bypassing permissions and runtime hooks for more autonomy. We'd love your feedback in #kanban on our [discord](https://discord.gg/cline).

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

### 1. Open kanban
```bash
# Run directly (no install required)
npx kanban

# Or install globally
npm i -g kanban
kanban
```

### Code changes (light default)

This `0.1.60-light` build changes the default theme from dark to light. Three files are modified:

**`package.json`**
- `version`: `"0.1.60"` → `"0.1.60-light"` (custom suffix to distinguish the build)

**`web-ui/src/hooks/use-theme.ts`** — line `readStoredThemeId()`
- Fallback return value: `"default"` → `"light"`
- When no theme is saved in localStorage, the hook returns `"light"` instead of `"default"`

**`web-ui/src/main.tsx`** — lines 16–28 (startup theme block)
- Before: if no saved theme (or saved theme is `"default"`), nothing was set — CSS `@theme {}` defaults (dark) took effect
- After: if no saved theme exists, `data-theme="light"` is applied immediately on `<html>`, preventing any flash of the dark theme

### Install from source

Build and install a local copy with a custom version suffix (e.g. `0.1.60-light`):

```bash
# 1. Set the desired version in package.json
#    Edit "version" to e.g. "0.1.60-light"

# 2. Install dependencies (root + web-ui)
npm run install:all

# 3. Build the project (web-ui SPA + bundled backend)
npm run build

# 4. Install to global node_modules
sudo rm -rf /usr/local/lib/node_modules/kanban /usr/local/bin/kanban
sudo mkdir -p /usr/local/lib/node_modules/kanban
sudo cp -r dist web-ui package.json /usr/local/lib/node_modules/kanban/
cd /usr/local/lib/node_modules/kanban
sudo npm install --omit=dev --ignore-scripts

# 5. Create the global bin symlink
sudo ln -s ../lib/node_modules/kanban/dist/cli.js /usr/local/bin/kanban

# 6. Verify
kanban --version
```

> **Note:** Adjust the sudo / permission commands to match your system. The key steps are: copy `dist/`, `web-ui/`, and `package.json` into `/usr/local/lib/node_modules/kanban/`, run `npm install --omit=dev --ignore-scripts` inside that directory, and symlink `dist/cli.js` to `/usr/local/bin/kanban`.
Run this from the root of any git repo. Kanban will detect your installed CLI agent and launch a local running webserver in your browser. No account or setup required, it works right out of the box.

### 2. Create tasks
Create a task card manually, or open the sidebar chat and ask your agent to break work down into tasks for you. Kanban injects board-management instructions into that session so you can simply ask it to add tasks, link tasks, or start work on your board.

### 3. Link and automate
<kbd>⌘</kbd> + click a card to link it to another task. When a card is completed and moved to trash, linked tasks auto-start. Combine with auto-commit for fully autonomous dependency chains: one task completes → commits → kicks off the next → repeat. It’s a pretty magical experience asking your agent to decompose a big task into subtasks that auto-commit - he’ll cleverly do it in a way that parallelizes for maximum efficiency and links tasks together for end-to-end autonomy.

### 4. Start tasks
Hit the play button on a card. Kanban creates an ephemeral worktree just for that task so agents work in parallel without merge conflicts. Under the hood, it also symlinks gitignored files like `node_modules` so you don't have to worry about slow `npm install`s for each copy of your project.

> [!NOTE]
> [Symlinks (symbolic links)](https://en.wikipedia.org/wiki/Symbolic_link) are special "shortcuts" pointing to another file or directory, allowing access to the target from a new location without duplicating data. They work great in this case since you typically don't modify gitignored files in day-to-day work, but for when you do then don't use Kanban.

As agents work, Kanban uses hooks to display the latest message or tool call on each card, so you can monitor hundreds of agents at a glance without opening each one.

### 5. Review changes
Click a card to view the agent's TUI and a diff of all the changes in that worktree. Kanban includes its own checkpointing system so you can also see a diff from the last messages you've sent. Click on lines to leave comments and send them back to the agent.

To easily test and debug your app, create a Script Shortcut in settings. Use a command like `npm run dev` so that all you have to do is hit a play button in the navbar instead of remembering commands or asking your agent to do it.

### 6. Ship it
When the work looks good, hit **Commit** or **Open PR**. Kanban sends a dynamic prompt to the agent to convert the worktree into a commit on your base ref or a new PR branch, and work through any merge conflicts intelligently. Or skip review by enabling auto-commit / auto-PR and the agent ships as soon as it's done. Move the card to trash to clean up the worktree (you can always resume later since Kanban tracks the resume ID).

### 7. Keep track with git interface
Click the branch name in the navbar to open a full git interface to browse commit history, switch branches, fetch, pull, push, and visualize your git all without leaving Kanban. Keep track of everything your agents are doing across branches as work is completed.

---

[Apache 2.0 © 2026 Cline Bot Inc.](./LICENSE)
