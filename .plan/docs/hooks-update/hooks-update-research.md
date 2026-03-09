
# Hooks Research For Kanban Agent Status

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
- posting a completion event to Kanban
- optional SMS/push via custom script


---


# Claude Code

see claude-code-hooks-docs.md

## Settings flag

You can pass in settings configurations to the Claude Code CLI using the --settings flag or by setting environment variables. 

Using the --settings Flag
The --settings flag allows you to load configurations from a specified JSON file or directly from a JSON string when launching Claude Code. 

Load from a JSON file:

claude --settings /path/to/your/settings.json
This approach is useful for applying a specific, temporary configuration for a session without altering your default user settings.
Load from a JSON string (inline):

claude --settings '{"model": "opus", "permissions": {"defaultMode": "plan"}}'
This lets you specify settings inline, which is handy for scripts or quick, one-off sessions.

# OpenCode

To pass configuration settings as flags in OpenCode, you can use CLI flags, environment variables, or specify a custom config file path directly in the command line. Key options include defining custom config files with --config or using environment variables like OPENCODE_CONFIG. 

Passing Configuration as Flags
Specify Config File: Use opencode --config /path/to/my/custom-config.json to override default settings.
Environment Variables: Set configuration directly in the terminal, such as OPENCODE_CONFIG=/path/to/config.json opencode.
Inline Config Content: Pass JSON configuration directly via the OPENCODE_CONFIG_CONTENT environment variable.
Web Server Config: If running opencode web, you can configure the server using flags like --port or --hostname. 

Common Configuration Flags
--config <path>: Specifies a custom configuration file.
--log-level <level>: Sets the logging level (DEBUG, INFO, WARN, ERROR).
--help / -h: Displays help information.
--version / -v: Prints the version number. 

Configuration Precedence 
OpenCode looks for configurations in this order: 

Custom config file via command line flag--config (Highest).
OPENCODE_CONFIG environment variable.
Project-level opencode.jsonc or opencode.json.
Global ~/.config/opencode/opencode.json. 

For more advanced control, you can use OPENCODE_CONFIG_DIR to specify a custom directory for all configuration files.

# Gemini CLI

The Gemini CLI accepts settings through command-line flags. These flags take the highest priority in the configuration hierarchy. 

Command-line Flags for Settings 
The Gemini CLI supports flags to override default or configured settings for a single session: 
--model <model_name> or -m <model_name>: Specifies the AI model for the session, for example, gemini-2.5-flash or gemini-3-pro-preview.
Example: gemini --model gemini-2.5-flash
--prompt <your_prompt> or -p <your_prompt>: Allows a prompt to be passed directly in non-interactive mode.
Example: gemini -p "Explain the configuration hierarchy of the Gemini CLI."
--config <file_location>: Allows a custom path to be specified for the configuration file, instead of the default ~/.gemini/settings.json.
Example: gemini --config ./my_custom_config.json
--output-format json: Used with the prompt flag for scripting to get structured output. 

Configuration Precedence
Settings are applied in the following order, with later items overriding earlier ones: 
Default values (hardcoded in the application).
System defaults file.
User settings file (~/.gemini/settings.json).
Project settings file (.gemini/settings.json).
System-wide override settings file.
Environment variables (e.g., GEMINI_API_KEY).
Command-line arguments (flags). 

For a complete reference, consult the Gemini CLI documentation or use the /settings command within the interactive CLI session

