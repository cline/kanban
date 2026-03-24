## Production Readiness Plan: User-Facing Documentation for Kanban

### Purpose

This document plans the user-facing documentation needed to make Kanban production-ready from a documentation and onboarding perspective.

The goal is not just to “have docs,” but to create documentation that is exceptionally easy for non-expert users to follow. The target standard is:

- a first-time user can quickly identify the path that applies to them
- prerequisites are explicit instead of implied
- setup failures are easy to diagnose
- the docs match the actual current product behavior
- the writing is accessible to laypersons, not just experienced terminal users

This plan is based on the current state of `kanban/` on `main` as of `0eb5657`, and informed by the latest `cline/` and `sdk-wip/` changes where those repos affect Kanban onboarding and setup.

---

## 1. Current-State Product Assessment

### 1.1 What changed since the earlier onboarding analysis

Kanban now has a materially different onboarding model than it did in the earlier state of this conversation.

Notable changes in current `main`:

- Kanban now includes a **startup onboarding dialog** (`web-ui/src/components/startup-onboarding-dialog.tsx`)
- onboarding now includes an **agent selection carousel** (`task-start-agent-onboarding-carousel.tsx`)
- Cline setup is now embedded into onboarding via a reusable **Cline setup section** (`cline-setup-section.tsx`)
- the old task-start service prompt flow has been removed in favor of broader onboarding/start-flow changes
- readiness logic has improved: `isTaskAgentSetupSatisfied()` now correctly treats **Cline as ready only when provider auth exists**, or when another launch-supported agent is installed
- Kanban now supports **git initialization confirmation** when adding a non-git project
- storage paths have moved under `~/.cline/kanban`
- worktrees have moved under `~/.cline/worktrees`
- runtime launch support is currently intentionally scoped to:
  - `cline`
  - `claude`
  - `codex`

Although the catalog still lists `opencode`, `droid`, and `gemini`, they are currently not launch-supported in production flow.

### 1.2 Current onboarding reality

The current product now has a stronger first-run experience than before, but the public docs do **not yet accurately reflect it**.

Examples of documentation drift:

- README still says:
  > “No account or setup required, it works right out of the box.”

  That is not reliably true for new users.

- README implies generic installed “CLI agent” detection, but current launch support is intentionally narrowed to `cline`, `claude`, and `codex`
- README does not explain the now-important distinction between:
  - Cline native setup inside Kanban
  - Claude/Codex external CLI setup outside Kanban
- README does not explain the new non-git project flow, where Kanban can offer to initialize git

This mismatch is now one of the biggest production-readiness gaps.

---

## 2. Documentation Goals

The documentation system should do five jobs well:

### Goal A — Explain what Kanban is in plain language

Users need a one-paragraph explanation that is concrete, not abstract.

They should immediately understand:

- Kanban is a local app opened from the terminal
- it runs in the browser
- it works on top of a code repository
- it uses agent CLIs to work task-by-task in worktrees

### Goal B — Help users identify their starting state

Users should not have to read everything.

The docs should very quickly separate people into these paths:

1. I already use Claude Code or Codex
2. I want to use Cline
3. I do not have any supported agent installed yet
4. I am not in a git repo yet
5. Something opened, but I still cannot start tasks

### Goal C — Make prerequisites explicit

Production-ready docs must clearly state which prerequisites are:

- always required
- sometimes required
- agent-specific
- OS-specific

### Goal D — Make troubleshooting actionable

The docs should convert vague failure states into clear diagnoses, such as:

- no supported agent found on PATH
- selected agent not authenticated
- Cline provider not configured
- repository not initialized as git
- browser did not auto-open
- port conflict

### Goal E — Keep docs aligned with the actual supported surface area

Docs must reflect the current launch-supported set and not overstate support.

That means the docs should distinguish:

- agents shown in the broader catalog
- agents actually launch-supported in current production path

---

## 3. Core Documentation Set Needed for Production Readiness

This section defines the minimum set of user-facing docs we should write.

### 3.1 README rewrite (top priority)

**Current problem:** the README is strong as a product teaser, but not reliable as first-time setup documentation.

**What the README should become:**

A concise, high-trust landing page that gets users to their first successful task start.

#### Proposed README structure

##### 1. What Kanban is

Plain-language summary, for example:

> Kanban is a local browser app for running coding agents in parallel on one codebase. Each task gets its own git worktree and agent session so you can review changes, leave comments, and ship work without agents stepping on each other.

##### 2. What you need before you start

Short checklist:

- Node.js 20+
- Git installed
- A project folder (Kanban can initialize git if needed)
- One supported agent path:
  - Cline (configured in Kanban)
  - Claude Code (installed and authenticated externally)
  - OpenAI Codex (installed and authenticated externally)

##### 3. Fastest path to first use

```bash
cd your-project
npx kanban
```

Then say exactly what happens next:

- browser opens
- onboarding dialog appears if needed
- choose an agent
- create a task
- press play

##### 4. Choose your setup path

A simple path-based table or section links:

- Use Cline
- Use Claude Code
- Use Codex
- No agent installed yet
- Not in a git repo yet

##### 5. First task walkthrough

Layperson-friendly, image-supported:

1. Add/open project
2. Create a task
3. Start it
4. Review changes
5. Commit or open PR

##### 6. Common problems

Examples:

- “Kanban opens but I can’t start tasks”
- “No projects yet”
- “No agent configured”
- “Cline provider not signed in”
- “Browser didn’t open automatically”

##### 7. Advanced capabilities

Keep the product wow-factor sections, but move them after setup success:

- linked tasks
- auto-commit
- review comments
- git interface

#### README writing guidance

- avoid saying “works right out of the box” unless that statement is narrowly qualified
- do not assume users know what “PATH,” “MCP,” or “worktree” mean without explanation
- use short paragraphs and bullets over dense prose

---

### 3.2 New “Getting Started” guide

**Recommended path:** create a dedicated stable user doc, likely something like:

- `docs/getting-started.md`

This should be the canonical setup guide for first-time users.

#### What it should cover

##### Section A — Before you begin

- what operating systems are supported in practice
- Node and Git requirements
- the difference between Kanban and the agent it uses

##### Section B — Pick your agent path

###### Path 1: Cline
- choose Cline in onboarding or Settings
- select provider
- select model
- authenticate with OAuth or enter API key
- confirm success state

###### Path 2: Claude Code
- install Claude Code
- authenticate Claude Code outside Kanban
- launch Kanban
- confirm Kanban detects Claude

###### Path 3: Codex
- install Codex
- authenticate Codex outside Kanban
- launch Kanban
- confirm Kanban detects Codex

###### Path 4: I have nothing installed yet
- recommended default path
- likely recommend either:
  - Cline for integrated setup, or
  - Claude Code if optimizing for terminal-native users

This should be a product decision documented explicitly.

##### Section C — Start your first task

- create task
- start task
- what the user should expect to see
- how to tell if the agent is actively working versus waiting for review

##### Section D — If you are adding a non-git folder

Document the new behavior:

- Kanban may ask to initialize git
- it stages current files and creates an initial commit
- explain what that means in plain language

This is important because many lay users will not realize Kanban depends on git worktrees.

---

### 3.3 New “Choose an Agent” guide

**Recommended file:**

- `docs/choose-an-agent.md`

This should answer the question:

> Which agent should I use with Kanban, and what setup does each one require?

#### Suggested structure

| Agent | Good default for | Setup location | Account/auth needed | Current launch support |
|---|---|---|---|---|
| Cline | users who want setup in Kanban | inside Kanban Settings/onboarding | yes, depending on provider | yes |
| Claude Code | existing Claude Code users | outside Kanban | yes | yes |
| Codex | existing Codex users | outside Kanban | yes | yes |
| OpenCode | not currently production launch-supported | outside Kanban | yes | not currently enabled |
| Droid | not currently production launch-supported | outside Kanban | yes | not currently enabled |
| Gemini | not currently production launch-supported | outside Kanban | yes | not currently enabled |

Important: this doc should be very explicit that the product catalog is broader than the currently launch-enabled set.

This avoids user confusion and future-proofs the docs if those agents are re-enabled later.

---

### 3.4 New troubleshooting guide

**Recommended file:**

- `docs/troubleshooting.md`

This should be optimized for search and skimming.

#### Recommended sections

##### “Kanban opened, but I can’t start tasks”

Likely causes:
- no supported launch-enabled agent installed
- Cline selected but not authenticated
- agent not on PATH

##### “No projects yet”

Explain:
- you launched outside a git repo or without indexed projects
- click Add project
- if folder is not git, Kanban may offer git initialization

##### “My browser didn’t open”

Explain:
- use the URL printed in the terminal
- mention `--no-open` and manual navigation

##### “Why am I being asked to initialize git?”

Explain worktrees in plain language.

##### “Why was Cline shown as not ready?”

Explain current readiness logic:
- provider must be selected and authenticated for Cline to be considered ready

##### “Claude/Codex installed but not detected”

Explain PATH inheritance and terminal environment realities without heavy jargon.

##### “Task won’t start because of dependencies”

Explain linked task behavior and backlog startability.

---

### 3.5 New “How Kanban works” layperson guide

**Recommended file:**

- `docs/how-kanban-works.md`

This should explain the concepts users keep tripping over:

- board
- task
- worktree
- review
- dependency links
- trash / restore
- auto-commit / PR

The tone should be non-technical.

This is not engineering architecture documentation; it is user mental-model documentation.

---

### 3.6 New “Cline setup in Kanban” guide

**Recommended file:**

- `docs/cline-setup.md`

This deserves its own page now because current Kanban deeply integrates Cline.

It should explain:

- selecting a provider
- model selection
- OAuth vs API key
- what “signed in” means
- optional MCP server setup in Cline settings
- what happens if provider settings are missing

This guide should align tightly with:

- `web-ui/src/components/shared/cline-setup-section.tsx`
- onboarding carousel behavior
- runtime auth readiness logic

---

## 4. What the docs must now explain differently because of current code

This section captures the updated thought tree based on the latest codebase.

### 4.1 Happy path has changed

The ideal current happy path is now:

#### Happy path A — Existing Claude user

1. Open a terminal in a project folder
2. Run `npx kanban`
3. Kanban opens in browser
4. Startup onboarding may appear
5. Select Claude Code
6. Create task and start it

This is now one of the cleanest paths because:

- Claude is launch-supported
- readiness logic understands installed launch-supported agents
- onboarding directly supports agent choice

#### Happy path B — New user choosing Cline

1. Run `npx kanban`
2. Onboarding opens
3. Choose Cline
4. Select provider/model
5. Authenticate via OAuth or API key
6. Close onboarding
7. Create and start task

This is now much better than before because current onboarding directly supports it.

### 4.2 The docs must explicitly explain the current launch-supported set

Current code:

- agent catalog lists 6 agents
- launch support is currently restricted to 3 (`cline`, `claude`, `codex`)

If docs don’t explain this cleanly, users will assume OpenCode/Droid/Gemini are equally production-ready right now.

That would be misleading.

### 4.3 Git initialization is now part of onboarding

When adding a non-git folder, Kanban now:

- asks for confirmation to initialize git
- creates an initial commit if needed

This is a major improvement, but it raises a documentation need:

users need to understand why this is necessary and what the implications are.

This should be documented in a calm, beginner-friendly way.

### 4.4 The previous “service prompt” model is gone

Older analysis emphasized task-start prompts for GitHub CLI, Linear MCP, and missing agent setup.

That is no longer the main onboarding path.

The new docs should focus instead on:

- startup onboarding
- Settings-based setup
- agent selection and authentication

The docs should not be built around a flow that has been removed.

---

## 5. Broken vs frictional states in the current product

This section replays the earlier thought tree against the latest code.

### 5.1 States that are now improved enough to be mostly friction, not broken

#### A. Cline readiness ambiguity

This was previously a real correctness problem.

It is now significantly improved:

- `isTaskAgentSetupSatisfied()` correctly checks Cline provider authentication
- if Cline is not authenticated, Kanban can still consider another installed launch-supported agent as sufficient

So this has moved from “broken” to “mostly solved.”

#### B. No-project first launch

This is now better supported:

- global-only onboarding works without a selected project
- onboarding/settings work even when there are no projects
- Add project flow is clearer

Still somewhat frictional, but not structurally broken.

#### C. Non-git project addition

This used to be a dead-end for many users.

Now there is an explicit confirmation path to initialize git.

That is much closer to production-ready, assuming it is documented clearly.

### 5.2 States that still appear production-risky or documentation-critical

#### A. README still overpromises setup simplicity

This is currently the biggest documentation problem.

Even though the product has improved, the README still implies universal zero-setup behavior.

That will create avoidable trust loss.

#### B. Agent support surface is easy to misunderstand

Because the catalog still shows non-launch-supported agents, users can infer that all are equally supported.

Documentation must disambiguate:

- discoverable in UI/catalog
- currently recommended / launch-enabled

#### C. External authentication requirements remain underexplained

For Claude Code and Codex, Kanban still depends on setup performed outside Kanban.

That is not inherently broken, but it becomes a broken user journey if docs do not say this clearly and early.

#### D. PATH/environment visibility is still a likely failure mode

Kanban still relies on inherited environment visibility for installed binaries.

Users with shells that only expose commands after special init paths may still hit confusion.

This belongs in troubleshooting docs.

#### E. Browser-opening and port behavior still need doc coverage

These are good implementation-wise, but still common first-run confusion points.

---

## 6. Recommended documentation deliverables and order

This is the implementation sequence I would recommend.

### Phase 1 — Trustworthy first-run surface

1. Rewrite `README.md`
2. Add `docs/getting-started.md`
3. Add `docs/troubleshooting.md`

Why first:
- these directly affect first impressions and first-run success

### Phase 2 — Agent clarity

4. Add `docs/choose-an-agent.md`
5. Add `docs/cline-setup.md`

Why second:
- these handle the most consequential branching decisions

### Phase 3 — Product mental model

6. Add `docs/how-kanban-works.md`

Why third:
- improves ongoing usability after basic onboarding works

### Phase 4 — Documentation index and linking pass

7. Update `docs/README.md`
8. Cross-link all docs from README and onboarding-relevant pages
9. Ensure no doc page becomes an orphan

---

## 7. Detailed writing requirements

These writing constraints should apply to every user-facing doc.

### 7.1 Audience assumptions

Assume the reader may:

- know basic terminal usage, but not advanced git
- not know what PATH means
- not know what a worktree is
- not know why a coding agent might need auth outside Kanban

Do not assume the reader is an infrastructure engineer.

### 7.2 Style requirements

- use plain English first, then technical detail second
- prefer “what to do” over “why this architecture exists”
- every setup step should have an observable success condition
- short sections, short paragraphs, strong headings
- use tables and decision trees where possible
- avoid jargon unless immediately explained

### 7.3 UX consistency requirements

Docs should use the same wording users see in the UI wherever possible, including:

- “Get started”
- “Add project”
- “Initialize git”
- “Cline setup”
- “No projects yet”
- “No agent configured”

This reduces cognitive translation.

### 7.4 Screenshot/media requirements

For production readiness, we should plan to include:

- onboarding dialog screenshot/video
- agent selection screenshot
- Cline setup screenshot
- first task creation screenshot
- review/diff screenshot
- Add project / Initialize git screenshot

Media should support the instructions, not replace them.

---

## 8. Proposed file plan

### Files to create

- `docs/getting-started.md`
- `docs/choose-an-agent.md`
- `docs/troubleshooting.md`
- `docs/how-kanban-works.md`
- `docs/cline-setup.md`

### Files to substantially update

- `README.md`
- `docs/README.md`

### Optional future files

- `docs/reviewing-and-shipping.md`
- `docs/task-automation-and-linking.md`
- `docs/faq.md`

---

## 9. Suggested doc outlines

### 9.1 `docs/getting-started.md`

1. What Kanban is
2. What you need first
3. Run Kanban
4. Choose an agent
5. Add or initialize a project
6. Create and start your first task
7. What success looks like
8. If something doesn’t work

### 9.2 `docs/choose-an-agent.md`

1. Which agents work with Kanban today
2. Which ones are currently recommended
3. Cline vs Claude vs Codex
4. Where setup happens for each
5. How to switch agents in Settings

### 9.3 `docs/troubleshooting.md`

1. Kanban doesn’t open
2. Browser didn’t open automatically
3. No projects yet
4. Asked to initialize git
5. No agent configured
6. Cline not signed in
7. Claude/Codex not detected
8. Task won’t start

### 9.4 `docs/how-kanban-works.md`

1. Board basics
2. Tasks and worktrees
3. Starting and reviewing work
4. Dependencies and task chains
5. Trash and restore
6. Commit / PR actions

### 9.5 `docs/cline-setup.md`

1. When to choose Cline
2. Provider and model selection
3. OAuth vs API key
4. Signs that setup is complete
5. Optional MCP setup
6. Common Cline setup problems

---

## 10. Acceptance criteria for the documentation project

We should treat this as done only when all of the following are true:

### Accuracy
- README and docs reflect the actual current supported launch flows
- docs correctly describe onboarding dialog behavior
- docs correctly describe Cline authentication readiness requirements
- docs correctly describe non-git project initialization behavior

### Usability
- a first-time user can identify their correct setup path in under a minute
- a user can determine whether setup happens inside or outside Kanban
- a user can diagnose the most common failure states without reading code

### Completeness
- all major first-run permutations are covered
- all current launch-supported agents are covered
- unsupported/not-currently-enabled agents are not misleadingly presented as equivalent

### Maintainability
- docs are cross-linked
- docs index is updated
- terminology is consistent with the UI

---

## 11. Recommended next implementation steps

### Immediate next step

Write the README rewrite first, because it currently carries the most user-facing risk.

### After that

1. Write `docs/getting-started.md`
2. Write `docs/choose-an-agent.md`
3. Write `docs/troubleshooting.md`
4. Write `docs/cline-setup.md`
5. Write `docs/how-kanban-works.md`
6. Update `docs/README.md`

### Suggested review process

Each doc should be reviewed for:

- plain-language clarity
- first-time-user readability
- accuracy against current UI wording
- correctness against current code paths

Ideally, each page should be test-read by someone who did not build the feature.

---

## 12. Bottom line

Kanban’s product onboarding is now substantially better than it was in the earlier state of this conversation. The product has moved from fragmented setup prompts toward a more coherent startup onboarding experience.

The biggest remaining production-readiness gap is no longer primarily missing UX — it is **documentation drift**.

The code now supports a clearer first-run story than the public docs currently tell.

So the documentation project should focus on:

- making the real happy paths obvious
- separating Cline setup from external CLI setup
- explicitly documenting prerequisites and supported agent scope
- translating first-run failure states into clear recovery steps

If we do that well, Kanban can feel far more polished and trustworthy to new users without changing core product behavior.