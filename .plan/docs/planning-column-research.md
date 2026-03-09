# Planning Column Research

Research into whether Kanban should have a "Planning" column and how it maps to ACP.

## The Problem

The original ideation chat proposed 5 kanban columns: Backlog, To Do, In Progress, Ready for Review, Done. But "To Do" feels redundant for agent orchestration -- there's no sprint commitment concept when you're dispatching agents. The question is what the right column set is, and whether a "Planning" column makes sense.

## ACP Task State Model

ACP defines two state machines:

Tool calls: `pending -> in_progress -> completed | failed`

Plan entries: `pending -> in_progress -> completed`

These are execution-level states, not workflow states. ACP doesn't have concepts like "backlog" or "review" -- it just tracks whether something is running. The kanban columns are a Kanban-layer concept that maps down to ACP, not the other way around.

## ACP Modes (the key finding)

ACP supports session modes. During session setup, agents advertise what modes they can operate in. The client can switch modes via `session/set_mode`, and agents can switch their own mode via `current_mode_update` notifications.

The ACP spec uses this example in its docs:

```json
{
  "availableModes": [
    { "id": "ask", "name": "Ask", "description": "Request permission before making any changes" },
    { "id": "architect", "name": "Architect", "description": "Design and plan software systems without implementation" },
    { "id": "code", "name": "Code", "description": "Write and modify code with full tool access" }
  ]
}
```

The spec explicitly describes a pattern where an agent starts in architect/plan mode, produces a plan, then calls an "exit mode" tool to transition to code mode. This exit triggers an ACP permission request that the client can intercept.

## What Zed's ACP Wrappers Actually Expose

### Claude Code (zed-industries/claude-agent-acp)

5 modes:

| Mode ID | Name | Description |
|---------|------|-------------|
| `default` | Default | Standard behavior, prompts for dangerous operations |
| `acceptEdits` | Accept Edits | Auto-accept file edit operations |
| `plan` | Plan Mode | Planning mode, no actual tool execution |
| `dontAsk` | Don't Ask | Don't prompt for permissions, deny if not pre-approved |
| `bypassPermissions` | Bypass Permissions | Bypass all permission checks (non-root only) |

Claude Code has native plan mode. When the model is ready to implement, it calls an `ExitPlanMode` tool. The Zed wrapper intercepts this and surfaces it as an ACP permission request with three options:
- "Yes, and auto-accept all actions" (switches to `acceptEdits`)
- "Yes, and manually accept actions" (switches to `default`)
- "No, stay in architect mode" (stays in `plan`)

There's also a `PostToolUse` hook that detects when the agent enters plan mode and sends a `current_mode_update` notification back to the client.

Source: `src/acp-agent.ts` in zed-industries/claude-agent-acp, lines 854 and 967-1019 for ExitPlanMode handling.

### Codex (zed-industries/codex-acp)

3 modes (purely permission-level, no plan mode):

| Mode ID | Name | Description |
|---------|------|-------------|
| `read-only` | Read Only | Can read files, approval required for edits/internet |
| `auto` | Default | Read/edit/run commands freely, approval for internet/external edits |
| `full-access` | Full Access | No restrictions |

Codex does NOT have a plan/architect mode. Its modes are about sandboxing and approval policies, not reasoning behavior.

Source: `codex-rs/utils/approval-presets/src/lib.rs` in zed-industries/codex fork.

### Gemini CLI

Not in the ACP ecosystem yet via Zed wrappers. Would need a custom integration.

## How a Planning Column Would Work

### For agents with native plan mode (Claude Code)

1. Card moves to Planning column
2. Kanban starts an ACP session with `modeId: "plan"`
3. Agent reads codebase, reasons about the task, produces a plan
4. Agent calls ExitPlanMode tool
5. Kanban intercepts the ACP permission request
6. The plan is surfaced on the card for user review
7. User approves -> card moves to In Progress, agent switches to code mode
8. User rejects / gives feedback -> agent re-plans in the Planning column

### For agents without native plan mode (Codex)

Simulated planning:
1. Card moves to Planning column
2. Kanban starts an ACP session in `read-only` mode
3. The task prompt is wrapped with instructions: "Analyze this task and produce a detailed implementation plan. Do not make any changes. Output your plan as structured content."
4. Agent reads codebase, produces a plan (can't write files due to read-only)
5. When the session completes, the plan is surfaced on the card
6. User approves -> a new session starts in `auto` mode with the plan as context
7. User rejects / gives feedback -> new read-only session with feedback

The key difference: with Claude Code, the agent transitions from plan to code within a single session. With Codex, you'd need two separate sessions (read-only for planning, auto for implementation), passing the plan as context to the second session.

### For agents outside ACP (Gemini CLI, others)

Same approach as the Codex simulation, but using the CLI's own flags for non-destructive execution. Or just prompt-engineering the planning step without relying on permission modes.

## Proposed Column Structure

| Column | What happens | ACP mapping |
|--------|-------------|-------------|
| Backlog | Ideas, issues, captured tasks. No agent session. | No session |
| Planning | Agent running in plan/architect mode. Reading code, producing a plan. No file changes. | Session in `plan` or `read-only` mode |
| In Progress | Agent running in code mode. Writing code in a worktree. | Session in `acceptEdits`, `auto`, or `bypassPermissions` mode |
| Review | Agent finished. Diff ready for user to inspect. | Session completed |
| Done | Work accepted (committed/PR'd). Worktree cleaned up on entry. | Post-session |

## Why This is Valuable

The Planning column enables a quality gate before burning compute on implementation. Key scenarios:

1. Parallel planning: Drag 10 tasks to Planning simultaneously. 10 agents read the codebase and produce plans in parallel. Planning is cheap (read-only, no file changes). Review all 10 plans quickly, then selectively approve the ones that look right for implementation.

2. Multi-agent bake-off at the plan level: Run Claude Code and Codex on the same task in Planning. Compare their approaches before either writes a line of code. Pick the better plan, then let that agent implement it.

3. Plan review as a first-class workflow step: For complex tasks, seeing the agent's plan before it writes code prevents wasted compute on bad approaches. The user can redirect early instead of reviewing a bad diff later.

4. Dependency chain optimization: Tasks in the dependency chain can auto-advance to Planning (not straight to In Progress), giving the user a chance to review the plan with updated context from completed dependencies before code starts.

## Open Questions

- Should moving to Planning be the default, or should users be able to skip straight to In Progress for simple tasks? (Probably: let users drag to either column. Planning is opt-in per task.)
- For the Codex simulation, how do we handle the context handoff between the planning session and the implementation session cleanly? (ACP session resume + injecting the plan as context.)
- Should the Planning column show the agent's live exploration (files being read, thinking), or just surface the final plan? (Probably: show live activity like other in-progress work, with the plan as the final artifact.)
- How does plan mode interact with task decomposition? The agent in plan mode could suggest breaking a task into subtasks as part of its plan output. That would be a natural integration point.
