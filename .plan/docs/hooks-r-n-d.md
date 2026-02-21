
# Hooks Research For Kanbanana Agent Status

We want a reliable way to move tasks from `In Progress` to `Review` when an agent needs user attention, and back from `Review` to `In Progress` when the user responds to agent.

## Codex findings

### 1) `notify` hook exists and is configurable

Codex supports `notify` in config:
- Global config: `~/.codex/config.toml`
- Project config: `.codex/config.toml`

You can set:

```toml
notify = ["/bin/bash", "/Users/saoud/.codex/ding.sh"]
```

### 2) We can pass `notify` per run with CLI flags

This avoids changing user global config and still keeps the rest of config in effect.

Examples:

```bash
codex -c 'notify=["/bin/bash","/Users/saoud/.codex/ding.sh"]'
```

```bash
codex exec -c 'notify=["/bin/bash","/Users/saoud/.codex/ding.sh"]' "fix lint errors"
```

Runtime config overrides are a separate config layer and are applied last.

### 3) `notify` payload shape

Current payload type is `agent-turn-complete` and includes:
- `thread-id`
- `turn-id`
- `cwd`
- `input-messages`
- `last-assistant-message`

The notify command receives this payload as the final argv argument.

### 4) When `notify` fires

Codex wires `notify` through an `after_agent` hook and dispatches it when a turn has completed.

This is useful for:
- completion nudges
- posting a completion event to Kanbanana
- optional SMS/push via custom script

### 5) `notify` limitation for attention detection

`notify` does not currently emit distinct event types for:
- waiting on approval
- waiting on user input

So `notify` by itself is not a complete signal for `In Progress -> Review (needs human input)`.

### 6) TUI notifications are separate

Codex TUI notifications can notify when terminal is unfocused for:
- approval requests
- turn completion

This is different from `notify`.

## Recommended Kanbanana integration design

### Event model

We only care about two state transitions, so keep the event model minimal:

Target transitions:
- `In Progress -> Review` when the agent needs user attention
- `Review -> In Progress` when work resumes
- optional completion mapping based on project preference

## Product direction

We should treat hooks setup as first-class runtime setup.

In Settings, for each agent row:
- keep existing `Use` button
- add `Configure hooks` button next to `Use`
- show explicit copy: selecting a runtime alone is not enough, hook setup is also required for automatic status updates

Suggested copy in Settings:
- "Automatic task status requires both steps: 1) Use this runtime 2) Configure hooks"

## Core integration contract

Add a Kanbanana CLI command that hook scripts call:

```bash
kanbanana hooks ingest \
  --task-id <taskId> \
  --event <needs_review|in_progress>
```

This command should update the session state for the task and broadcast to UI listeners.

## Runtime mapping model

Normalize each runtime into the same event contract:

```json
{
  "taskId": "KAN-123",
  "event": "needs_review",
  "timestamp": "2026-02-21T10:20:30Z"
}
```

Kanbanana state mapping:
- `needs_review` -> `awaiting_review` with `reviewReason = "attention"`
- `in_progress` -> `running` with `reviewReason = null`

## Codex notes

Codex supports `notify` hook and runtime override via `-c`:

```bash
codex -c 'notify=["/bin/bash","/path/to/codex-hook.sh"]'
```

