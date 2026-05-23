# Desktop stack 5-way split — handoff prompt

Paste everything below this line into a fresh Cline session.

---

# TASK: Execute 5-way split of the Kanban desktop PR stack

Repo: `cline/kanban` at `/Users/johnchoi1/main/kanban-desktop`.

## Current state (verified, tests green, DMG built & validated)

**Stack** (rooted on `origin/main`):
```
pr/desktop-2-webui-compat      (22 web-ui files — leave untouched)
pr/desktop-3-scaffolding       (28 files — SCAFFOLDING, SPLIT THIS)
pr/desktop-4-electron-main     (14 files — ELECTRON MAIN + REFACTOR, SPLIT THIS)
```

**Commits on pr/desktop-4-electron-main** (top of stack):
- `d75a0c74` fix(build): stage runtime externals into dist/node_modules/ for standalone deployment  ← root `scripts/build.mjs` — REQUIRED for packaged app to launch; maps to PR3 bootstrap in the split
- `17e388da` refactor(desktop): use path-based URLs for project windows
- `36f3523d` feat(desktop): Electron main process, multi-window, deep links, and state persistence
- `1a206293` feat(desktop): package scaffolding, runtime-child manager, and build infrastructure

**Test status**: 161/161 desktop tests + 536/536 root tests passing. Typecheck clean. Fresh DMG at `packages/desktop/out/Kanban-0.0.1-arm64.dmg` (125 MB, built from HEAD, verified `app.asar` contains all refactored modules, verified packaged `cli.js` boots via both `node cli/cli.js --help` and the `bin/kanban` shim).

**CRITICAL build-infrastructure fix that must land BEFORE PR3 (or be folded into it)**: The root `scripts/build.mjs` now stages all externals (zod, commander, @trpc/*, @sentry/node, @modelcontextprotocol/sdk, ws, open, proper-lockfile, tree-kill, node-pty) into `dist/node_modules/` after esbuild. Without this the packaged CLI fails at `import "zod"` resolution because the Electron app has no enclosing `node_modules/` for `Resources/cli/cli.js`. See commit `d75a0c74` for context + trade-off analysis. In the split, this change logically belongs in PR3 bootstrap (alongside the root vitest.config exclusion change), since it's root-level build infrastructure that the desktop package implicitly depends on.

**Recent refactor** (already landed in `36f3523d` via amend): `main.ts` went from 661 → 314 lines, split into:
- `src/runtime-orchestrator.ts` (200 lines) — RuntimeOrchestrator class, runtime lifecycle, health check, crash handling, power-save
- `src/window-factory.ts` (168 lines) — WindowFactory class, window creation, renderer recovery, disconnected screen
- `src/app-menu.ts` (175 lines) — AppMenu class, menu template

## Goal

Replace current PR3 + PR4 with 5 new focused PRs (each individually reviewable). PR2 web-ui stays untouched.

## Target stack

| # | Branch | Files | Runtime deps | Scripts added |
|---|---|---|---|---|
| **PR3** | `pr/desktop-3-bootstrap` | `.gitignore` additions, root `vitest.config.ts` (add `packages/**` to exclude), `packages/desktop/{package.json, package-lock.json, tsconfig.json, tsconfig.build.json, vitest.config.ts}` | **none** — devDeps only: electron, @electron/rebuild, @electron/notarize, electron-builder, typescript, vitest, @types/node, shx, esbuild | `test`, `typecheck` |
| **PR4** | `pr/desktop-4-runtime-child` | `src/runtime-child.ts`, `src/runtime-child-config.ts`, `src/runtime-child-env.ts`, `test/runtime-child-config.test.ts`, `test/runtime-child-env.test.ts` | **none** (node built-ins only) | — |
| **PR5** | `pr/desktop-5-preflight` | `src/desktop-preflight.ts`, `test/desktop-preflight.test.ts` | **+ node-pty** | — |
| **PR6** | `pr/desktop-6-electron-main` | `src/{main, runtime-orchestrator, window-factory, app-menu, window-registry, window-state, protocol-handler, oauth-relay, preload, kanban.d.ts, disconnected.html}`, `test/{main, window-registry, window-state, protocol-handler, oauth-relay}.test.ts` | **none** (only electron itself — already a devDep) | `build:ts` (tsc + esbuild preload + `shx cp src/disconnected.html dist/`) |
| **PR7** | `pr/desktop-7-packaging` | `build/bin/{kanban, kanban-dev, kanban.cmd}`, `build/{entitlements.mac.plist, icon.icns, icon.png}`, `electron-builder.yml`, `scripts/{launch-electron.mjs, notarize.cjs, patch-node-pty.mjs}`, `test/{cli-shim, notarize}.test.ts` | **none** | `build`, `build:mac`, `build:mac:arm64`, `build:mac:x64`, `dev`, `rebuild:pty`, `postinstall`, `start` |

## Dep analysis (already verified by grep)

- `runtime-child*.ts`: only `node:events`, `node:child_process`, `node:http`, `node:path` — NO external deps
- `desktop-preflight.ts`: only `node:fs` for static imports; dynamically `require()`s `node-pty` to check ABI loadability
- All `main.ts` / orchestrator / factory / menu / window / protocol / oauth / preload: only `electron` itself. NO `electron-updater`, NO `@trpc/*`, NO runtime deps beyond what Electron provides.

This is why PR3 can start with zero runtime deps, and only PR5 adds `node-pty`.

## Execution plan

1. **Safety tags first** (so nothing is ever lost):
   ```bash
   cd /Users/johnchoi1/main/kanban-desktop
   git tag backup/pr3-scaffolding-v1 1a206293
   git tag backup/pr4-electron-main-v1 17e388da
   ```

2. **Capture reference snapshots** of file contents into `/tmp/kanban-split/` so you can read them across branch checkouts without re-greping git:
   ```bash
   mkdir -p /tmp/kanban-split
   git archive pr/desktop-4-electron-main packages/desktop/ | tar -x -C /tmp/kanban-split
   ```

3. **Build PR3 (bootstrap)** from origin/main:
   ```bash
   git checkout -B pr/desktop-3-bootstrap origin/main
   ```
   - **Cherry-pick the build-infrastructure fix**: `git cherry-pick d75a0c74` (scripts/build.mjs — root externals staging). This is what makes packaged cli.js resolvable.
   - Write a TRIMMED `packages/desktop/package.json` with only devDeps (electron, @electron/rebuild, @electron/notarize, electron-builder, typescript, vitest, @types/node, shx, esbuild) and only `test`/`typecheck` scripts.
   - Copy `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts` from `/tmp/kanban-split/packages/desktop/` unchanged.
   - Update root `vitest.config.ts` to add `"packages/**"` to the `exclude` array.
   - Update root `.gitignore` to add `packages/desktop/out`, `packages/desktop/*.tgz`, `*.tgz`.
   - Regen lockfile: `cd packages/desktop && npm install`.
   - Either squash the cherry-picked build.mjs commit into your bootstrap commit, or keep it separate as "fix(build): stage runtime externals" with the bootstrap as a second commit on the same PR3 branch. Reviewer preference.
   - Verify: `npm test` (should report "no test files found" cleanly, not error), `npx tsc --noEmit -p tsconfig.json`, `npm run build` at root (should create `dist/node_modules/` with 11 deps + transitive).

4. **Build PR4 (runtime-child)** on top of PR3:
   ```bash
   git checkout -B pr/desktop-4-runtime-child pr/desktop-3-bootstrap
   git checkout pr/desktop-4-electron-main -- packages/desktop/src/runtime-child.ts packages/desktop/src/runtime-child-config.ts packages/desktop/src/runtime-child-env.ts packages/desktop/test/runtime-child-config.test.ts packages/desktop/test/runtime-child-env.test.ts
   ```
   - No package.json changes needed (no new deps).
   - Commit + verify tests pass.

5. **Build PR5 (preflight)** on top of PR4:
   ```bash
   git checkout -B pr/desktop-5-preflight pr/desktop-4-runtime-child
   git checkout pr/desktop-4-electron-main -- packages/desktop/src/desktop-preflight.ts packages/desktop/test/desktop-preflight.test.ts
   ```
   - Add `"node-pty": "^1.0.0"` (check exact version in current package.json) to `dependencies` in `packages/desktop/package.json`.
   - Regen lockfile: `npm install` inside packages/desktop/.
   - Commit + verify tests pass.

6. **Build PR6 (electron-main)** on top of PR5:
   ```bash
   git checkout -B pr/desktop-6-electron-main pr/desktop-5-preflight
   git checkout pr/desktop-4-electron-main -- \
     packages/desktop/src/main.ts \
     packages/desktop/src/runtime-orchestrator.ts \
     packages/desktop/src/window-factory.ts \
     packages/desktop/src/app-menu.ts \
     packages/desktop/src/window-registry.ts \
     packages/desktop/src/window-state.ts \
     packages/desktop/src/protocol-handler.ts \
     packages/desktop/src/oauth-relay.ts \
     packages/desktop/src/preload.ts \
     packages/desktop/src/kanban.d.ts \
     packages/desktop/src/disconnected.html \
     packages/desktop/test/main.test.ts \
     packages/desktop/test/window-registry.test.ts \
     packages/desktop/test/window-state.test.ts \
     packages/desktop/test/protocol-handler.test.ts \
     packages/desktop/test/oauth-relay.test.ts
   ```
   - Add `build:ts` script to `packages/desktop/package.json`:
     ```
     "build:ts": "tsc -p tsconfig.build.json && esbuild src/preload.ts --bundle --platform=node --format=cjs --external:electron --outfile=dist/preload.js && shx cp src/disconnected.html dist/disconnected.html"
     ```
   - Commit + verify: `npm test` (should show 161 passing), `npm run typecheck`, `npm run build:ts`.

7. **Build PR7 (packaging)** on top of PR6:
   ```bash
   git checkout -B pr/desktop-7-packaging pr/desktop-6-electron-main
   git checkout pr/desktop-4-electron-main -- \
     packages/desktop/build/ \
     packages/desktop/electron-builder.yml \
     packages/desktop/scripts/ \
     packages/desktop/test/cli-shim.test.ts \
     packages/desktop/test/notarize.test.ts
   ```
   - Add remaining scripts to `packages/desktop/package.json`:
     ```
     "build": "npm run rebuild:pty && npm run build:ts && electron-builder",
     "build:mac": "npm run rebuild:pty && npm run build:ts && electron-builder --mac",
     "build:mac:arm64": "npm run rebuild:pty && npm run build:ts && electron-builder --mac --arm64",
     "build:mac:x64": "npm run rebuild:pty && npm run build:ts && electron-builder --mac --x64",
     "dev": "node scripts/launch-electron.mjs",
     "rebuild:pty": "electron-builder install-app-deps",
     "postinstall": "npm run rebuild:pty && node scripts/patch-node-pty.mjs",
     "start": "electron ."
     ```
   - Commit + verify: full build pipeline works end-to-end.

8. **Final verification**:
   ```bash
   # At each branch head, ensure tests pass:
   for br in pr/desktop-3-bootstrap pr/desktop-4-runtime-child pr/desktop-5-preflight pr/desktop-6-electron-main pr/desktop-7-packaging; do
     git checkout $br
     cd packages/desktop && npm test && npx tsc --noEmit -p tsconfig.json && cd ../..
   done

   # Confirm PR7 matches current pr/desktop-4-electron-main tree exactly:
   git diff pr/desktop-7-packaging pr/desktop-4-electron-main -- packages/desktop/ .gitignore vitest.config.ts
   # should be EMPTY. If not, investigate which file got missed.
   ```

9. **Do NOT delete `pr/desktop-3-scaffolding` or `pr/desktop-4-electron-main` until user confirms the new stack is good.** Backup tags provide belt-and-suspenders.

## Critical architectural constraints (don't break these)

- **Zero imports from root `kanban` package** — desktop launches CLI as subprocess via `spawn("kanban", …)`. No `require("kanban")` anywhere in packages/desktop/src/.
- **Runtime deps in packages/desktop/package.json**: ONLY `node-pty`. Everything else the runtime needs is bundled into `dist/cli.js` via esbuild at the root, then copied into the packaged app via `extraResources` (so the CLI is self-contained and ships as a single file).
- **asar unpack is narrowed** to just `node_modules/node-pty/**` — must NOT be `node_modules/**` (that bloat is what the architecture fix from Milestone 1 resolved).
- **`electron-builder.yml` `extraResources`** copies `../../dist/` → `Resources/cli/` in the packaged app. The `build/bin/kanban` shim resolves `Resources/cli/cli.js`.
- **Constants inlined** — `DEFAULT_HOST = "127.0.0.1"`, `DEFAULT_PORT = 3484` appear directly in `main.ts` and `runtime-orchestrator.ts`. No cross-package constants imports.
- **`src/index.ts` at repo root is UNCHANGED from origin/main** — only exports `api-contract`. The desktop package must not add to it.

## File locations (for reference during split)

All source files to split come from `pr/desktop-4-electron-main` HEAD (`17e388da`). Current file layout:

```
packages/desktop/
├── .gitignore                    (minor additions, lives at repo root .gitignore)
├── build/
│   ├── bin/{kanban, kanban-dev, kanban.cmd}    → PR7
│   ├── entitlements.mac.plist                   → PR7
│   ├── icon.icns, icon.png                      → PR7
├── electron-builder.yml                         → PR7
├── package.json                                 → SPLIT across PR3 (devDeps), PR5 (+node-pty), PR6 (+build:ts), PR7 (+electron-builder scripts)
├── package-lock.json                            → regenerate per PR via `npm install`
├── scripts/
│   ├── launch-electron.mjs                      → PR7
│   ├── notarize.cjs                             → PR7
│   └── patch-node-pty.mjs                       → PR7
├── src/
│   ├── runtime-child.ts                         → PR4
│   ├── runtime-child-config.ts                  → PR4
│   ├── runtime-child-env.ts                     → PR4
│   ├── desktop-preflight.ts                     → PR5
│   ├── main.ts                                  → PR6
│   ├── runtime-orchestrator.ts                  → PR6
│   ├── window-factory.ts                        → PR6
│   ├── app-menu.ts                              → PR6
│   ├── window-registry.ts                       → PR6
│   ├── window-state.ts                          → PR6
│   ├── protocol-handler.ts                      → PR6
│   ├── oauth-relay.ts                           → PR6
│   ├── preload.ts                               → PR6 (moves from current PR3 to main PR per AGENTS.md discussion)
│   ├── kanban.d.ts                              → PR6
│   ├── disconnected.html                        → PR6
├── test/
│   ├── runtime-child-config.test.ts             → PR4
│   ├── runtime-child-env.test.ts                → PR4
│   ├── desktop-preflight.test.ts                → PR5
│   ├── main.test.ts                             → PR6
│   ├── window-registry.test.ts                  → PR6
│   ├── window-state.test.ts                     → PR6
│   ├── protocol-handler.test.ts                 → PR6
│   ├── oauth-relay.test.ts                      → PR6
│   ├── cli-shim.test.ts                         → PR7
│   └── notarize.test.ts                         → PR7
├── tsconfig.json                                → PR3
├── tsconfig.build.json                          → PR3
└── vitest.config.ts                             → PR3
```

## Commit message templates

Keep commit messages focused. Suggested first lines:

- PR3: `feat(desktop): bootstrap packages/desktop workspace (tsconfig, vitest, devDeps)`
- PR4: `feat(desktop): runtime child process manager with filtered env and PATH enrichment`
- PR5: `feat(desktop): pre-boot preflight checks for preload, CLI binary, and node-pty`
- PR6: `feat(desktop): Electron main process with multi-window, deep links, and state persistence`
- PR7: `feat(desktop): electron-builder packaging, CLI shims, and release scripts`

The current PR4 commit message (`36f3523d`) has good body content that can be split across PR5/PR6/PR7.

## Start with

```bash
cd /Users/johnchoi1/main/kanban-desktop
git status       # should be clean
git tag backup/pr3-scaffolding-v1 1a206293
git tag backup/pr4-electron-main-v1 17e388da
mkdir -p /tmp/kanban-split
git archive pr/desktop-4-electron-main packages/desktop/ | tar -x -C /tmp/kanban-split
```

Then proceed with PR3 bootstrap as described above.

---

# Session addendum (2026-04-16 late)

Nothing in the stack changed this session. No code edits, no rebases, no force-pushes. The handoff plan above is still the source of truth for the next session's technical work.

Two non-code outcomes worth recording:

## 1. Global Cline rules path fix (done)

Cline v1 (which `Cline CLI - Node.js` runs on top of) reads global rules from `~/Documents/Cline/Rules/` — **not** `~/.clinerules/` and **not** `~/AGENTS.md`. Verified by reading `cline/cline/src/core/context/instructions/user-instructions/external-rules.ts` (`findAgentsMdFiles(cwd)` walks only DOWN from cwd) and `src/core/storage/disk.ts` (global rules path is under `~/Documents/Cline/`).

On this machine, the user's rules had been sitting in `~/.clinerules/*.md` and `~/AGENTS.md` the whole time — none reachable by Cline. The canonical directory existed but was empty.

Fixed in-place by symlinking (non-destructive):
```
~/Documents/Cline/Rules/agents-global-rules.md  -> ~/AGENTS.md
~/Documents/Cline/Rules/coding-standards.md     -> ~/.clinerules/coding-standards.md
~/Documents/Cline/Rules/global-safety-rules.md  -> ~/.clinerules/global-safety-rules.md
```

The next session will see these global rules in its system prompt automatically. No action needed from the next agent beyond "actually follow them."

## 2. GitHub-write guardrail — critical for the next agent

Once the global rules load, the next agent will see this in `~/AGENTS.md`:

> **NEVER post comments, reviews, or replies on GitHub PRs or issues.** No `gh pr review`, no `gh pr comment`, no `gh issue comment`. The only GitHub write operations allowed are pushing code to branches. No exceptions.
> **NEVER create GitHub issues unless the user explicitly asks you to create one.** No exceptions.

Read that literally. Previous sessions repeatedly violated this because the rule wasn't loading into context (now fixed). Operational reading for this stack specifically: `git push` to feature branches is fine. Anything else — `gh pr create`, `gh pr edit` (title/body), `gh pr comment`, `gh pr review`, `gh pr close`, `gh pr reopen`, any `gh api` mutation — requires an explicit per-action ask: paste the intended command/content in chat, wait for user's "yes, run it," then run it. Prior authorization on PR N does not carry to PR M or to a different action on PR N.

Reading `gh` commands (`gh pr view`, `gh issue view`, `gh api GET`) are fine without asking.

## 3. Stack status on this machine (unchanged)

Same as the top of this doc:
- `pr/desktop-2-webui-compat` — 22 files, untouched
- `pr/desktop-3-scaffolding` — 28 files, HEAD unchanged
- `pr/desktop-4-electron-main` — 14 files, HEAD unchanged (commit `17e388da` at top per earlier verification)

Tests last green: 161/161 desktop + 536/536 root. DMG at `packages/desktop/out/Kanban-0.0.1-arm64.dmg` still valid (no changes since it was built).

MILESTONE 1 from the previous todo list is NOT done — no `package.json`, `electron-builder.yml`, or `build/bin/*` edits happened this session. Pick up there.
