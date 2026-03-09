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
- posting a completion event to Kanban
- optional SMS/push via custom script
