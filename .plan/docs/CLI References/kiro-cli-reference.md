Session Management
Kiro CLI automatically saves all chat sessions on every conversation turn. Sessions are stored per-directory in the database, allowing you to resume from any previous session, export to files, or integrate with custom storage solutions.

Auto-save
Automatic: Every conversation turn saved to database
Scope: Per-directory (each project has own sessions)
Storage: Local database (~/.kiro/)
Session ID: UUID for each session

Managing sessions
From command line
bash

# Resume most recent session
kiro-cli chat --resume

# Interactive picker
kiro-cli chat --resume-picker

# List all sessions
kiro-cli chat --list-sessions

# Delete session
kiro-cli chat --delete-session <SESSION_ID>
From chat
bash

# Start a fresh conversation (saves current session automatically)
/chat new

# Start a fresh conversation with an initial prompt
/chat new how do I set up a React project

# Resume session (interactive)
/chat resume

# Save to file
/chat save <path>

# Load from file
/chat load <path>
File extension
The .json extension is optional when loading sessions.

Custom storage via scripts
Use custom scripts to save/load sessions from version control, cloud storage, or databases.

Save via script
bash

/chat save-via-script <script-path>
Script receives session JSON via stdin.

Example: Save to Git Notes

bash

#!/bin/bash
COMMIT=$(git rev-parse HEAD)
TEMP=$(mktemp)
cat > "$TEMP"
git notes --ref=kiro/notes add -F "$TEMP" "$COMMIT" --force
rm "$TEMP"
echo "Saved to commit ${COMMIT:0:8}" >&2
Load via script
bash

/chat load-via-script <script-path>
Script outputs session JSON to stdout.

Example: Load from Git Notes

bash

#!/bin/bash
COMMIT=$(git rev-parse HEAD)
git notes --ref=kiro/notes show "$COMMIT"
Session storage
Database: Sessions auto-saved per-directory
Files: Manual export via /chat save
Custom: Script-based integration

Session ID: UUID format (e.g., f2946a26-3735-4b08-8d05-c928010302d5)

Examples
Resume last session
bash

kiro-cli chat --resume
Continues most recent conversation.

Pick session interactively
bash

kiro-cli chat --resume-picker
Shows list of sessions to choose from.

Export to file

/chat save backup.json
Exports current session to file.

Version control integration
bash

# Save to git notes
/chat save-via-script ./scripts/save-to-git.sh

# Load from git notes
/chat load-via-script ./scripts/load-from-git.sh
Troubleshooting
No sessions to resume
Symptom: "No saved chat sessions"
Cause: No sessions in current directory
Solution: Sessions are per-directory. Navigate to correct directory.

Script save fails
Symptom: Script exits with error
Cause: Script returned non-zero exit code
Solution: Test script manually. Ensure it exits 0 on success.

Script load fails
Symptom: Can't load session
Cause: Script didn't output valid JSON
Solution: Test script outputs valid session JSON to stdout.

Limitations
Sessions stored per-directory
Auto-save to database only (not files)
Session IDs are UUIDs (not human-readable)
No cloud sync (use scripts for custom storage)
No session search by content
Technical details
Storage: SQLite database in ~/.kiro/

Scope: Sessions keyed by directory path

Auto-save: After every conversation turn

Script interface:

Save: JSON via stdin, exit 0 on success
Load: JSON via stdout, exit 0 on success

----

Subagents
Subagents are specialized agents that can autonomously execute complex tasks on your behalf. They have their own context, tool access, and decision-making capabilities, making them ideal for sophisticated multi-step operations.

Key capabilities
Autonomous execution - Run independently with their own context, with the level of autonomy depending on agent configuration
Live progress tracking - Monitor real-time status updates as subagents work through tasks
Core tool access - Read files, execute commands, write files, and use MCP tools
Parallel execution - Run multiple subagents simultaneously for efficient task execution
Result aggregation - Results automatically returned to the main agent when complete
Default subagent
Kiro includes a default subagent that can handle general-purpose tasks. When you assign a task to a subagent, the default subagent is used unless you specify a custom agent configuration.

Custom subagents
You can spawn subagents using your own agent configurations. This allows you to create specialized subagents tailored to specific workflows:

bash

> Use the backend agent to refactor the payment module
To use a custom agent as a subagent, reference it by name when assigning tasks. The subagent will inherit the tool access and settings from that agent's configuration.

How subagents work
Task assignment - You describe a task, and Kiro determines if a subagent is appropriate
Subagent initialization - The subagent is created with its own context and tool access based on its agent configuration
Autonomous execution - The subagent works through the task independently, though it may pause to request user approval for certain tool permissions
Progress updates - You receive live progress updates showing current work
Result return - When complete, results are returned to the main agent
Tool availability
Subagents run in a separate runtime environment. Some tools available in normal chat are not yet implemented in subagents.

Available tools:

read - Read files and directories
write - Create and edit files
shell - Execute bash commands
code - Code intelligence (search symbols, find references)
MCP tools
Not available:

web_search - Web research
web_fetch - Fetch URLs
introspect - CLI info
thinking - Reasoning tool
todo_list - Task tracking
use_aws - AWS commands
grep - Search file contents
glob - Find files by pattern
Agent configuration
If your custom agent configuration includes tools that aren't available in subagents, those tools will simply be unavailable when the agent runs as a subagent. The agent will still function with the available tools.

Configuring subagent access
You can control which agents are available as subagents and which can run without permission prompts.

Restricting available agents
Use availableAgents to limit which agents can be spawned as subagents:

json

{
  "toolsSettings": {
    "subagent": {
      "availableAgents": ["reviewer", "tester", "docs-*"]
    }
  }
}
With this configuration, only the reviewer, tester, and agents matching docs-* can be used as subagents. Glob patterns are supported.

Trusting specific agents
Use trustedAgents to allow specific agents to run without permission prompts:

json

{
  "name": "orchestrator",
  "description": "Agent that coordinates multiple specialized subagents",
  "tools": ["fs_read", "subagent"],
  "toolsSettings": {
    "subagent": {
      "trustedAgents": ["reviewer", "tester", "analyzer"]
    }
  }
}
With this configuration, the orchestrator agent can spawn the reviewer, tester, and analyzer subagents without requiring user approval each time. Glob patterns like test-* are supported.

Combining both settings
You can use both settings together for fine-grained control:

json

{
  "toolsSettings": {
    "subagent": {
      "availableAgents": ["reviewer", "tester", "analyzer", "docs-*"],
      "trustedAgents": ["reviewer", "tester"]
    }
  }
}
This allows four agents to be spawned as subagents, but only reviewer and tester run without prompts.

Best practices
Use for complex tasks - Most valuable for multi-step operations that benefit from isolation
Provide clear instructions - Specific task descriptions lead to better results
Monitor progress - Check on long-running subagents periodically
Review results - Verify subagent output before acting on recommendations

---

Plan agent
The Plan agent is a specialized built-in agent that helps transform ideas into structured implementation plans. It guides you through requirements gathering, research, and creates detailed task breakdowns before switching to execution mode.

Getting started
Keyboard shortcut
Press Shift + Tab to toggle between plan and execution modes.

Slash command
bash

> /plan

Switched to the Kiro [plan] agent. Transform any idea into fully working code.
What do you want to build today?

[plan] >
With immediate prompt
bash

> /plan Build a REST API for user authentication
When active, you'll see:

[plan] indicator in your prompt
Welcome message when switching modes
Plan workflow
1. Requirements gathering
The planner guides you through structured questions to refine your initial idea.

bash

[plan] > I want to build a todo app

I understand you want to build a todo app. Let me help you plan this
implementation.

**My Understanding:** You want to create a todo application for managing tasks.

Let me gather some requirements to create a detailed plan:

[1]: What platform should this todo app target?
a. **Web Application** - Browser-based with HTML/CSS/JavaScript
b. **Mobile App** - Native iOS/Android or cross-platform
c. **Desktop App** - Electron, Tauri, or native desktop
d. **CLI Tool** - Command-line interface
e. **Other** - Provide your own answer

[2]: What's the primary use case for this todo app?
a. **Personal Task Management** - Individual productivity
b. **Team Collaboration** - Shared tasks and assignments
c. **Project Management** - Complex workflows with dependencies
d. **Other** - Describe your specific needs

(Use the chat to answer any subset: eg., "1=a, 2=b" or provide your own answers)
Feature	Description
Structured questions	Clear, numbered questions with multiple choice options
Flexible responses	Answer individual questions or provide custom responses
Iterative process	Builds understanding through multiple rounds of questions
Context awareness	Adapts follow-up questions based on your answers
2. Research and analysis
The planner explores your codebase and researches relevant technologies.

Capability	Description
Code exploration	Uses code, grep, and glob tools to understand existing code
Technology research	Identifies relevant frameworks, libraries, and patterns
Architecture analysis	Reviews existing project structure and conventions
3. Implementation plan
Creates a detailed, step-by-step implementation plan with clear objectives.

bash

**Implementation Plan - Todo CLI Command**

**Problem Statement:** Add todo management to existing Kiro CLI for task tracking.

**Requirements:**
- CLI commands for CRUD operations
- Local SQLite storage
- Priority and due date support

**Task Breakdown:**

Task 1: Create database schema and models
- Define Todo struct with required fields
- Create database migration for todos table
- Demo: Can create and query todos in database

Task 2: Implement CLI command structure
- Add todo subcommand with add/list/complete operations
- Demo: CLI accepts todo commands and shows help

Task 3: Add advanced features
- Implement due dates and priority sorting
- Demo: Complete todo system with all features
Each task includes:

Clear objectives - Specific, measurable goals
Implementation guidance - General approach and key considerations
Demo description - Working functionality that can be demonstrated
4. Plan approval and handoff
Before switching to execution, the planner seeks your approval.

bash

[plan] > Does this plan look good, or would you like me to adjust anything?

> The plan looks great! Let's implement it.

*Planning complete!* Ready to exit [plan] agent to start your implementation? [y/n]:

> y
The handoff process:

You approve the implementation plan
Interactive prompt confirms switching to execution
Automatically transitions back to previous agent
Complete plan is passed to the execution agent
Read-only design
The Plan agent operates in read-only mode to keep focus on planning.

Operation	Status
File reading	✓ Full access to explore codebase
Code intelligence	✓ LSP operations for understanding code structure
Search (grep, glob)	✓ Code exploration
Web search	✓ Documentation and research access
File writing	✗ Cannot create or modify files
Command execution	✗ Limited to read-only bash commands
MCP tools	✗ Cannot use MCP tools
Best practices
Use for complex tasks - Most valuable for multi-step implementations
Engage with questions - Answer structured questions thoughtfully
Let it explore - Allow planner to analyze your existing codebase
Review plans - Ensure plan matches expectations before handoff
Iterate as needed - Continue refining until plan is clear
Troubleshooting
Issue	Solution
How to exit plan agent?	Use Shift + Tab to return to your previous agent.
Planning session interrupted	Use /plan to re-enter planning and continue where you left off.
Plan not transferring to execution agent	Make sure to respond "y" when prompted with "Ready to exit [plan] agent to start your implementation? [y/n]".
Example workflow
bash

> /plan Add user authentication to my web app

[plan] > I understand you want to add user authentication to your web application.

**My Understanding:** You want to implement user authentication functionality
for an existing web application.

[1]: What authentication method do you prefer?
a. **Email/Password** - Traditional username and password
b. **OAuth** - Google, GitHub, or other OAuth providers
c. **Magic Links** - Passwordless email-based authentication
d. **Multi-factor** - Combination of methods with 2FA

> 1=a

[plan] > Great! Email/password authentication it is.

[2]: What's your current tech stack?
a. **React + Node.js** - JavaScript full-stack
b. **Next.js** - React with server-side rendering
c. **Django/Flask** - Python web framework
d. **Other** - Please specify

> 2=d, I'm using Rust with Axum framework

[plan] > Perfect! Rust with Axum is an excellent choice for secure authentication.

*Researching Axum authentication patterns...*
*Exploring your existing codebase structure...*

**Implementation Plan - User Authentication System**
[Detailed plan follows...]

Does this plan look good, or would you like me to adjust anything?

> Looks perfect!

Ready to exit [plan] agent to start your implementation? [y/n]: y

[default] > Implement this plan: [Plan content transferred to execution agent]

----

Creating custom agents
Custom agents allow you to tailor Kiro CLI behavior for specific tasks by defining which tools are available, what permissions are granted, and what context is automatically included.

Quick start
You can create an agent using the /agent create slash command from within a Kiro CLI chat session. By default, it uses AI-assisted mode to generate a full agent configuration based on your description:

text

> /agent create

✔ Enter agent name:  · backend-specialist
✔ Enter agent description:  · You are a specialist in backend coding practices
✔ Agent scope · Local (current workspace)
Select MCP servers (use Space to toggle, Enter to confirm): markdown-downloader (node), code-analysis (uv)

✓ Agent 'backend-specialist' has been created and saved successfully!
You can also provide a name and options inline:

text

> /agent create backend-specialist -D "Backend coding specialist" -m code-analysis
Info
/agent generate is an alias for /agent create. Both commands behave identically.

Alternatively, use the CLI command directly from your terminal:

bash

kiro-cli agent create backend-specialist
Options
The /agent create slash command and the kiro-cli agent create CLI command share some flags, while others are exclusive to the slash command:

Flag	Description	Availability
--directory	Where to save the agent (see directory values)	Both
--from	Template agent to base the new agent on (implies --manual)	Both
--description	Description of the agent	Slash command
--mcp-server	MCP server to include (repeatable)	Slash command
--manual	Use editor-based creation instead of AI generation	Slash command
Warning
The --description and --mcp-server flags are only available in AI-assisted mode. They cannot be combined with --manual or --from.

Directory values
The --directory flag accepts two special values in addition to custom paths:

Value	Description
workspace	Creates the agent in .kiro/agents/ in your current working directory
global	Creates the agent in ~/.kiro/agents/ (the default)
./path or /path	Creates the agent in the specified custom path
When no --directory is specified, agents are saved to the global directory (~/.kiro/agents/).

Manual creation mode
If you prefer to define the agent configuration yourself in an editor rather than using AI generation, pass the --manual flag:

text

> /agent create my-agent --manual
This opens your default editor with a basic agent configuration file. You can also base a new agent on an existing one using --from:

text

> /agent create my-agent --from backend-specialist
Agent configuration file
Custom agents are defined using JSON configuration files. Here's a basic example:

json

{
  "name": "my-agent",
  "description": "A custom agent for my workflow",
  "tools": ["read","write"],
  "allowedTools": ["read"],
  "resources": [
    "file://README.md",
    "file://.kiro/steering/**/*.md",
    "skill://.kiro/skills/**/SKILL.md"
  ],
  "prompt": "You are a helpful coding assistant",
  "model": "claude-sonnet-4"
}
Using your custom agent
Start a new chat session - which uses the default agent ("kiro_default") and swap to an agent using the agent slash command

bash

> /agent swap

 Choose one of the following agents 
❯ rust-developer-agent
  kiro_default
  backend-specialist
After selecting an agent, you will see the following:

bash

✔ Choose one of the following agents · backend-specialist

[backend-specialist] > 
Alternatively, start a chat session with your custom agent:

bash

kiro-cli --agent my-agent

----

Agent configuration reference
Every agent configuration file can include the following sections:

name — The name of the agent (optional, derived from filename if not specified).
description — A description of the agent.
prompt — High-level context for the agent.
mcpServers — The MCP servers the agent has access to.
tools — The tools available to the agent.
toolAliases — Tool name remapping for handling naming collisions.
allowedTools — Tools that can be used without prompting.
toolsSettings — Configuration for specific tools.
resources — Resources available to the agent.
hooks — Commands run at specific trigger points.
includeMcpJson — Whether to include MCP servers from mcp.json files.
model — The model ID to use for this agent.
keyboardShortcut — Keyboard shortcut for quickly switching to this agent.
welcomeMessage — Message displayed when switching to this agent.
Name field
The name field specifies the name of the agent. This is used for identification and display purposes.

json

{
  "name": "aws-expert"
}
Description field
The description field provides a description of what the agent does. This is primarily for human readability and helps users distinguish between different agents.

json

{
  "description": "An agent specialized for AWS infrastructure tasks"
}
Prompt field
The prompt field is intended to provide high-level context to the agent, similar to a system prompt. It supports both inline text and file:// URIs to reference external files.

Inline prompt
json

{
  "prompt": "You are an expert AWS infrastructure specialist"
}
File URI prompt
You can reference external files using file:// URIs. This allows you to maintain long, complex prompts in separate files for better organization and version control, while keeping your agent configuration clean and readable.

json

{
  "prompt": "file://./my-agent-prompt.md"
}
File URI path resolution
Relative paths: Resolved relative to the agent configuration file's directory
"file://./prompt.md" → prompt.md in the same directory as the agent config
"file://../shared/prompt.md" → prompt.md in a parent directory
Absolute paths: Used as-is
"file:///home/user/prompts/agent.md" → Absolute path to the file
File URI examples
json

{
  "prompt": "file://./prompts/aws-expert.md"
}
json

{
  "prompt": "file:///Users/developer/shared-prompts/rust-specialist.md"
}
McpServers field
The mcpServers field specifies which Model Context Protocol (MCP) servers the agent has access to. Each server is defined with a command and optional arguments.

json

{
  "mcpServers": {
    "fetch": {
      "command": "fetch3.1",
      "args": []
    },
    "git": {
      "command": "git-mcp",
      "args": [],
      "env": {
        "GIT_CONFIG_GLOBAL": "/dev/null"
      },
      "timeout": 120000
    }
  }
}
Each MCP server configuration can include:

command (required): The command to execute to start the MCP server
args (optional): Arguments to pass to the command
env (optional): Environment variables to set for the server
timeout (optional): Timeout for each MCP request in milliseconds (default: 120000)
oauth (optional): OAuth configuration for HTTP-based MCP servers
redirectUri (optional): Custom redirect URI for OAuth flow (e.g., "127.0.0.1:7778")
oauthScopes (optional): Array of OAuth scopes to request (e.g., ["read", "write"])
OAuth configuration
For HTTP-based MCP servers that require OAuth authentication, you can configure OAuth scopes:

json

{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.github.com/mcp",
      "oauth": {
        "redirectUri": "127.0.0.1:8080",
        "oauthScopes": ["repo", "user"]
      }
    }
  }
}
If you encounter OAuth scope-related errors, you can configure an empty array to bypass scope requirements within the MCP server configuration:

json

{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.github.com/mcp",
      "oauth": {
        "redirectUri": "127.0.0.1:8080",
        "oauthScopes": []
      }
    }
  }
}
Tools field
The tools field lists all tools that the agent can potentially use. Tools include built-in tools and tools from MCP servers.

Built-in tools are specified by their name (e.g., read, shell)
MCP server tools are prefixed with @ followed by the server name (e.g., @git)
To specify a specific tool from an MCP server, use @server_name/tool_name
Use * as a special wildcard to include all available tools (both built-in and from MCP servers)
Use @builtin to include all built-in tools
Use @server_name to include all tools from a specific MCP server
json

{
  "tools": [
    "read",
    "write",
    "shell",
    "@git",
    "@rust-analyzer/check_code"
  ]
}
To include all available tools, you can simply use:

json

{
  "tools": ["*"]
}
ToolAliases field
The toolAliases field is an advanced feature that allows you to remap tool names. This is primarily used to resolve naming collisions between tools from different MCP servers, or to create more intuitive names for specific tools.

For example, if both @github-mcp and @gitlab-mcp servers provide a tool called get_issues, you would have a naming collision. You can use toolAliases to disambiguate them:

json

{
  "toolAliases": {
    "@github-mcp/get_issues": "github_issues",
    "@gitlab-mcp/get_issues": "gitlab_issues"
  }
}
With this configuration, the tools will be available to the agent as github_issues and gitlab_issues instead of having a collision on get_issues.

You can also use aliases to create shorter or more intuitive names for frequently used tools:

json

{
  "toolAliases": {
    "@aws-cloud-formation/deploy_stack_with_parameters": "deploy_cf",
    "@kubernetes-tools/get_pod_logs_with_namespace": "pod_logs"
  }
}
The key is the original tool name (including server prefix for MCP tools), and the value is the new name to use.

AllowedTools field
The allowedTools field specifies which tools can be used without prompting the user for permission. This is a security feature that helps prevent unauthorized tool usage.

json

{
  "allowedTools": [
    "read",
    "write",
    "@git/git_status",
    "@server/read_*",
    "@fetch"
  ]
}
You can allow tools using several patterns:

Exact matches
Built-in tools: "read", "shell", "knowledge"
Specific MCP tools: "@server_name/tool_name" (e.g., "@git/git_status")
All tools from MCP server: "@server_name" (e.g., "@fetch")
Wildcard patterns
The allowedTools field supports glob-style wildcard patterns using * and ?:

MCP tool patterns
Tool prefix: "@server/read_*" → matches @server/read_file, @server/read_config
Tool suffix: "@server/*_get" → matches @server/issue_get, @server/data_get
Server pattern: "@*-mcp/read_*" → matches @git-mcp/read_file, @db-mcp/read_data
Any tool from pattern servers: "@git-*/*" → matches any tool from servers matching git-*
Optionally, you can also prefix native tools with the namespace @builtin.

Examples
json

{
  "allowedTools": [
    // Exact matches
    "read",
    "knowledge",
    "@server/specific_tool",
    
    // Native tool wildcards
    "r*",                    // Read
    "w*",               // Write
    @builtin,                // All native tools
    
    // MCP tool wildcards
    "@server/api_*",           // All API tools from server
    "@server/read_*",          // All read tools from server
    "@git-server/get_*_info",  // Tools like get_user_info, get_repo_info
    "@*/status",               // Status tool from any server
    
    // Server-level permissions
    "@fetch",                  // All tools from fetch server
    "@git-*"                   // All tools from any git-* server
  ]
}
Pattern matching rules
* matches any sequence of characters (including none)
? matches exactly one character
Exact matches take precedence over patterns
Server-level permissions (@server_name) allow all tools from that server
Case-sensitive matching
Unlike the tools field, the allowedTools field does not support the "*" wildcard for allowing all tools. To allow tools, you must use specific patterns or server-level permissions.

ToolsSettings field
The toolsSettings field provides configuration for specific tools. Each tool can have its own unique configuration options. Note that specifications that configure allowable patterns will be overridden if the tool is also included in allowedTools.

json

{
  "toolsSettings": {
    "write": {
      "allowedPaths": ["~/**"]
    },
    "@git/git_status": {
      "git_user": "$GIT_USER"
    }
  }
}
Resources field
The resources field gives an agent access to local resources. Resources can be files, skills, or knowledge bases.

json

{
  "resources": [
    "file://README.md",
    "file://.kiro/steering/**/*.md",
    "skill://.kiro/skills/**/SKILL.md"
  ]
}
Resources support different types via URI schemes:

file:// — Files loaded directly into context at startup
skill:// — Skills with metadata loaded at startup, full content loaded on demand
Both support:

Specific paths: file://README.md or skill://my-skill.md
Glob patterns: file://.kiro/**/*.md or skill://.kiro/skills/**/SKILL.md
Absolute or relative paths
File resources
File resources are loaded directly into the agent's context when the agent starts. Use these for content the agent always needs.

json

{
  "resources": [
    "file://README.md",
    "file://docs/**/*.md"
  ]
}
Skill resources
Skills are progressively loaded — only metadata (name and description) is loaded at startup, with full content loaded on demand when the agent determines it's needed. This keeps context lean while giving agents access to extensive documentation.

Skill files must begin with YAML frontmatter containing name and description:

markdown

---
name: dynamodb-data-modeling
description: Guide for DynamoDB data modeling best practices. Use when designing or analyzing DynamoDB schema.
---

# DynamoDB Data Modeling

... full content here ...
json

{
  "resources": [
    "skill://.kiro/skills/**/SKILL.md"
  ]
}
Write specific descriptions so the agent can reliably determine when to load the full content.

Knowledge base resources
Knowledge base resources allow agents to search indexed documentation and content. With support for millions of tokens of indexed content and incremental loading, agents can efficiently search large documentation sets.

json

{
  "resources": [
    {
      "type": "knowledgeBase",
      "source": "file://./docs",
      "name": "ProjectDocs",
      "description": "Project documentation and guides",
      "indexType": "best",
      "autoUpdate": true
    }
  ]
}
Fields:

Field	Required	Description
type	Yes	Must be "knowledgeBase"
source	Yes	Path to index. Use file:// prefix for local paths
name	Yes	Display name for the knowledge base
description	No	Brief description of the content
indexType	No	Indexing strategy: "best" (default, higher quality) or "fast" (quicker indexing)
autoUpdate	No	Re-index when agent spawns. Default: false
Use cases:

Share team documentation across agents
Give agents access to project-specific context (specs, decisions, meeting notes)
Index large codebases and documentation
Keep agent knowledge current with autoUpdate: true
Hooks field
The hooks field defines commands to run at specific trigger points during agent lifecycle and tool execution.

For detailed information about hook behavior, input/output formats, and examples, see the Hooks documentation.

json

{
  "hooks": {
    "agentSpawn": [
      {
        "command": "git status"
      }
    ],
    "userPromptSubmit": [
      {
        "command": "ls -la"
      }
    ],
    "preToolUse": [
      {
        "matcher": "execute_bash",
        "command": "{ echo \"$(date) - Bash command:\"; cat; echo; } >> /tmp/bash_audit_log"
      },
      {
        "matcher": "use_aws",
        "command": "{ echo \"$(date) - AWS CLI call:\"; cat; echo; } >> /tmp/aws_audit_log"
      }
    ],
    "postToolUse": [
      {
        "matcher": "fs_write",
        "command": "cargo fmt --all"
      }
    ]
  }
}
Each hook is defined with:

command (required): The command to execute
matcher (optional): Pattern to match tool names for preToolUse and postToolUse hooks. Hook matchers use internal tool names (fs_read, fs_write, execute_bash, use_aws) rather than simplified names. See built-in tools documentation for available tool names.
Available hook triggers:

agentSpawn: Triggered when the agent is initialized.
userPromptSubmit: Triggered when the user submits a message.
preToolUse: Triggered before a tool is executed. Can block the tool use.
postToolUse: Triggered after a tool is executed.
stop: Triggered when the assistant finishes responding.
includeMcpJson field
The includeMcpJson field determines whether to include MCP servers defined in the MCP configuration files (~/.kiro/settings/mcp.json for global and <cwd>/.kiro/settings/mcp.json for workspace).

json

{
  "includeMcpJson": true
}
When set to true, the agent will have access to all MCP servers defined in the global and local configurations in addition to those defined in the agent's mcpServers field.

Model field
The model field specifies the model ID to use for this agent. If not specified, the agent will use the default model.

json

{
  "model": "claude-sonnet-4"
}
The model ID must match one of the available models returned by the Kiro CLI's model service. You can see available models by using the /model command in an active chat session.

If the specified model is not available, the agent will fall back to the default model and display a warning.

KeyboardShortcut field
The keyboardShortcut field configures a keyboard shortcut for quickly switching to this agent during a chat session.

json

{
  "keyboardShortcut": "ctrl+a"
}
Shortcuts consist of a modifier and a key, separated by +:

Modifiers (optional):

ctrl - Control key
shift - Shift key
Keys:

Single letter: a-z (case insensitive)
Single digit: 0-9
Examples:

json

"keyboardShortcut": "ctrl+a"           // Control + A
"keyboardShortcut": "shift+b"          // Shift + B
Toggle Behavior:

When you press a keyboard shortcut:

If you're on a different agent: switches to this agent
If you're already on this agent: switches back to your previous agent
Conflict Handling:

If multiple agents have the same keyboard shortcut, a warning is logged and the shortcut is disabled. Use /agent swap to switch manually in this case.

WelcomeMessage field
The welcomeMessage field specifies a message displayed when switching to this agent.

json

{
  "welcomeMessage": "What would you like to build today?"
}
This message appears after the agent switch confirmation, helping orient users to the agent's purpose.

Complete example
Here's a complete example of an agent configuration file:

json

{
  "name": "aws-rust-agent",
  "description": "A specialized agent for AWS and Rust development tasks",
  "mcpServers": {
    "fetch": {
      "command": "fetch3.1",
      "args": []
    },
    "git": {
      "command": "git-mcp",
      "args": []
    }
  },
  "tools": [
    "read",
    "write",
    "shell",
    "aws",
    "@git",
    "@fetch/fetch_url"
  ],
  "toolAliases": {
    "@git/git_status": "status",
    "@fetch/fetch_url": "get"
  },
  "allowedTools": [
    "read",
    "@git/git_status"
  ],
  "toolsSettings": {
    "write": {
      "allowedPaths": ["src/**", "tests/**", "Cargo.toml"]
    },
    "aws": {
      "allowedServices": ["s3", "lambda"]
    }
  },
  "resources": [
    "file://README.md",
    "file://docs/**/*.md"
  ],
  "hooks": {
    "agentSpawn": [
      {
        "command": "git status"
      }
    ],
    "userPromptSubmit": [
      {
        "command": "ls -la"
      }
    ]
  },
  "useLegacyMcpJson": true,
  "model": "claude-sonnet-4",
  "keyboardShortcut": "ctrl+r",
  "welcomeMessage": "Ready to help with AWS and Rust development!"
}
Agent configuration files are JSON files that define how your custom agents behave. The filename (without .json) becomes the agent's name.

Quick start
We recommend using the /agent generate command within your active Kiro session to intelligently generate agent configurations with AI assistance.

File locations
You can define local agents and global agents.

Local agents (project-specific)

.kiro/agents/
Local agents are specific to the current workspace and only available when running Kiro CLI from that directory or its subdirectories.

Example:


my-project/
├── .kiro/
│   └── agents/
│       ├── dev-agent.json
│       └── aws-specialist.json
└── src/
    └── main.py
Global agents (user-wide)

~/.kiro/agents/
Global agents are available from any directory.

Example:


~/.kiro/agents/
├── general-assistant.json
├── code-reviewer.json
└── documentation-writer.json
Agent precedence
When Kiro CLI looks for an agent:

Local first: Checks .kiro/agents/ in the current directory
Global fallback: Checks ~/.kiro/agents/ in the HOME directory
If both locations have agents with the same name, the local agent takes precedence with a warning message.

Configuration fields
name
The agent's name for identification and display.

json

{
  "name": "aws-expert"
}
description
Human-readable description of the agent's purpose.

json

{
  "description": "An agent specialized for AWS infrastructure tasks"
}
prompt
High-level context for the agent, similar to a system prompt. Supports inline text or file:// URIs.

Inline:

json

{
  "prompt": "You are an expert AWS infrastructure specialist"
}
File URI:

json

{
  "prompt": "file://./my-agent-prompt.md"
}
Path Resolution:

Relative paths: Resolved relative to agent config file
"file://./prompt.md" → Same directory as agent config
"file://../shared/prompt.md" → Parent directory
Absolute paths: Used as-is
"file:///home/user/prompts/agent.md"
mcpServers
MCP servers the agent can access.

json

{
  "mcpServers": {
    "fetch": {
      "command": "fetch-server",
      "args": []
    },
    "git": {
      "command": "git-mcp",
      "args": [],
      "env": {
        "GIT_CONFIG_GLOBAL": "/dev/null"
      },
      "timeout": 120000
    }
  }
}
Fields:

command (required): Command to start the MCP server
args (optional): Arguments for the command
env (optional): Environment variables
timeout (optional): Request timeout in milliseconds (default: 120000)
tools
Tools available to the agent.

json

{
  "tools": [
    "read",
    "write",
    "shell",
    "@git",
    "@rust-analyzer/check_code"
  ]
}
Tool References:

Built-in tools: "read", "shell"
All MCP server tools: "@server_name"
Specific MCP tool: "@server_name/tool_name"
All tools: "*"
All built-in tools: "@builtin"
toolAliases
Remap tool names to resolve naming collisions or create intuitive names.

json

{
  "toolAliases": {
    "@github-mcp/get_issues": "github_issues",
    "@gitlab-mcp/get_issues": "gitlab_issues",
    "@aws-cloud-formation/deploy_stack_with_parameters": "deploy_cf"
  }
}
allowedTools
Tools that can be used without prompting for permission.

json

{
  "allowedTools": [
    "read",
    "@git/git_status",
    "@server/read_*",
    "@fetch"
  ]
}
Pattern Support:

Exact Matches:

Built-in: "read", "shell"
MCP tool: "@server_name/tool_name"
All server tools: "@server_name"
Wildcards:

Prefix: "code_*" → code_review, code_analysis
Suffix: "*_bash" → execute_bash, run_bash
Single char: "?ead" → read, head
MCP patterns: "@server/read_*", "@git-*/status"
toolsSettings
Configuration for specific tools.

json

{
  "toolsSettings": {
    "write": {
      "allowedPaths": ["~/**"]
    },
    "shell": {
      "allowedCommands": ["git status", "git fetch"],
      "deniedCommands": ["git commit .*", "git push .*"],
      "autoAllowReadonly": true
    },
    "@git/git_status": {
      "git_user": "$GIT_USER"
    }
  }
}
See Built-in Tools for tool-specific options.

resources
Local resources available to the agent. Supports file resources, skill resources, and knowledge bases.

File resources:

json

{
  "resources": [
    "file://README.md",
    "file://.kiro/steering/**/*.md",
    "skill://.kiro/skills/**/SKILL.md"
  ]
}
Knowledge base resources:

json

{
  "resources": [
    {
      "type": "knowledgeBase",
      "source": "file://./docs",
      "name": "ProjectDocs",
      "description": "Project documentation",
      "indexType": "best",
      "autoUpdate": true
    }
  ]
}
Resource types:

file:// — Loaded into context at startup
skill:// — Metadata loaded at startup, full content loaded on demand
Both support specific files, glob patterns, and absolute or relative paths.

Knowledge base fields:

type: Must be "knowledgeBase"
source: Path to index (use file:// prefix)
name: Display name
description: Optional description
indexType: "best" (default) or "fast"
autoUpdate: Re-index on agent spawn (default: false)
hooks
Commands to run at specific trigger points.

json

{
  "hooks": {
    "agentSpawn": [
      {
        "command": "git status"
      }
    ],
    "userPromptSubmit": [
      {
        "command": "ls -la"
      }
    ],
    "preToolUse": [
      {
        "matcher": "execute_bash",
        "command": "{ echo \"$(date) - Bash:\"; cat; } >> /tmp/audit.log"
      }
    ],
    "postToolUse": [
      {
        "matcher": "fs_write",
        "command": "cargo fmt --all"
      }
    ],
    "stop": [
      {
        "command": "npm test"
      }
    ]
  }
}
Hook Types:

agentSpawn: When agent is activated
userPromptSubmit: When user submits a prompt
preToolUse: Before tool execution (can block)
postToolUse: After tool execution
stop: When assistant finishes responding
See Hooks for detailed documentation.

model
Model ID to use for this agent.

json

{
  "model": "claude-sonnet-4"
}
If not specified or unavailable, falls back to default model.

keyboardShortcut
Keyboard shortcut for quickly switching to this agent.

json

{
  "keyboardShortcut": "ctrl+a"
}
Format: [modifier+]key

Modifiers: ctrl, shift

Keys: a-z, 0-9

Behavior:

Pressing the shortcut switches to this agent
Pressing again while on this agent switches back to the previous agent
Conflicting shortcuts are disabled with a warning
welcomeMessage
Message displayed when switching to this agent.

json

{
  "welcomeMessage": "What would you like to build today?"
}
This message appears after the agent switch confirmation, helping orient users to the agent's purpose.

Complete example
json

{
  "name": "aws-rust-agent",
  "description": "Specialized agent for AWS and Rust development",
  "prompt": "file://./prompts/aws-rust-expert.md",
  "mcpServers": {
    "fetch": {
      "command": "fetch-server",
      "args": []
    },
    "git": {
      "command": "git-mcp",
      "args": []
    }
  },
  "tools": [
    "read",
    "write",
    "shell",
    "aws",
    "@git",
    "@fetch/fetch_url"
  ],
  "toolAliases": {
    "@git/git_status": "status",
    "@fetch/fetch_url": "get"
  },
  "allowedTools": [
    "read",
    "@git/git_status"
  ],
  "toolsSettings": {
    "write": {
      "allowedPaths": ["src/**", "tests/**", "Cargo.toml"]
    },
    "aws": {
      "allowedServices": ["s3", "lambda"],
      "autoAllowReadonly": true
    }
  },
  "resources": [
    "file://README.md",
    "file://docs/**/*.md"
  ],
  "hooks": {
    "agentSpawn": [
      {
        "command": "git status"
      }
    ],
    "postToolUse": [
      {
        "matcher": "fs_write",
        "command": "cargo fmt --all"
      }
    ]
  },
  "model": "claude-sonnet-4",
  "keyboardShortcut": "ctrl+shift+r",
  "welcomeMessage": "Ready to help with AWS and Rust development!"
}
Best practices
Start restrictive: Begin with minimal tool access and expand as needed
Name clearly: Use descriptive names that indicate the agent's purpose
Document usage: Add clear descriptions to help team members understand the agent
Version control: Store agent configurations in your project repository
Test thoroughly: Verify tool permissions work as expected before sharing
Local vs global agents
Use Local Agents For:

Project-specific configurations
Agents needing project files/tools
Development environments with unique requirements
Sharing with team via version control
Use Global Agents For:

General-purpose agents across projects
Personal productivity agents
Agents without project-specific context
Commonly used tools and workflows
Security
Review allowedTools carefully
Use specific patterns over wildcards
Configure toolsSettings for sensitive operations
Test agents in safe environments first
Organization
Use descriptive agent names
Document agent purposes in descriptions
Keep prompt files organized
Version control local agents with projects

----

Hooks
Hooks allow you to execute custom commands at specific points during agent lifecycle and tool execution. This enables security validation, logging, formatting, context gathering, and other custom behaviors.

Defining hooks
Hooks are defined in the agent configuration file. See the Agent Configuration Reference for the complete syntax and examples.

Hook event
Hooks receive hook event in JSON format via STDIN:

json

{
  "hook_event_name": "agentSpawn",
  "cwd": "/current/working/directory"
}
For tool-related hooks, additional fields are included:

tool_name: Name of the tool being executed
tool_input: Tool-specific parameters (see individual tool documentation)
tool_response: Tool execution results (PostToolUse only)
Hook output
Exit code 0: Hook succeeded. STDOUT is captured but not shown to user.
Exit code 2: (PreToolUse only) Block tool execution. STDERR is returned to the LLM.
Other exit codes: Hook failed. STDERR is shown as warning to user.
Tool matching
Use the matcher field to specify which tools the hook applies to. You can use either canonical tool names or their aliases.

Examples
"fs_write" or "write" - Match write tool
"fs_read" or "read" - Match read tool
"execute_bash" or "shell" - Match shell command execution
"use_aws" or "aws" - Match AWS CLI tool
"@git" - All tools from git MCP server
"@git/status" - Specific tool from git MCP server
"*" - All tools (built-in and MCP)
"@builtin" - All built-in tools only
No matcher - Applies to all tools
Tool name aliases
Hook matchers support both canonical names (fs_read, fs_write, execute_bash, use_aws) and their aliases (read, write, shell, aws). Use whichever you prefer.

For complete tool reference format, see Agent Configuration Reference.

Hook types
AgentSpawn
Runs when agent is activated. No tool context provided.

Hook Event

json

{
  "hook_event_name": "agentSpawn",
  "cwd": "/current/working/directory"
}
Exit Code Behavior:

0: Hook succeeded, STDOUT is added to agent's context
Other: Show STDERR warning to user
UserPromptSubmit
Runs when user submits a prompt. Output is added to conversation context.

Hook Event

json

{
  "hook_event_name": "userPromptSubmit",
  "cwd": "/current/working/directory",
  "prompt": "user's input prompt"
}
Exit Code Behavior:

0: Hook succeeded, STDOUT is added to agent's context
Other: Show STDERR warning to user
PreToolUse
Runs before tool execution. Can validate and block tool usage.

Hook Event

json

{
  "hook_event_name": "preToolUse",
  "cwd": "/current/working/directory",
  "tool_name": "read",
  "tool_input": {
    "operations": [
      {
        "mode": "Line",
        "path": "/current/working/directory/docs/hooks.md"
      }
    ]
  }
}
Exit Code Behavior:

0: Allow tool execution.
2: Block tool execution, return STDERR to LLM.
Other: Show STDERR warning to user, allow tool execution.
PostToolUse
Runs after tool execution with access to tool results.

Hook Event

json

{
  "hook_event_name": "postToolUse",
  "cwd": "/current/working/directory",
  "tool_name": "read",
  "tool_input": {
    "operations": [
      {
        "mode": "Line",
        "path": "/current/working/directory/docs/hooks.md"
      }
    ]
  },
  "tool_response": {
    "success": true,
    "result": ["# Hooks\n\nHooks allow you to execute..."]
  }
}
Exit Code Behavior:

0: Hook succeeded.
Other: Show STDERR warning to user. Tool already ran.
Stop
Runs when the assistant finishes responding to the user (at the end of each turn). This is useful for running post-processing tasks like code compilation, testing, formatting, or cleanup after the assistant's response.

Hook Event

json

{
  "hook_event_name": "stop",
  "cwd": "/current/working/directory"
}
Exit Code Behavior:

0: Hook succeeded.
Other: Show STDERR warning to user.
Note: Stop hooks do not use matchers since they don't relate to specific tools.

MCP Example
For MCP tools, the tool name includes the full namespaced format including the MCP Server name:

Hook Event

json

{
  "hook_event_name": "preToolUse",
  "cwd": "/current/working/directory",
  "tool_name": "@postgres/query",
  "tool_input": {
    "sql": "SELECT * FROM orders LIMIT 10;"
  }
}
Timeout
Default timeout is 30 seconds (30,000ms). Configure with timeout_ms field.

Caching
Successful hook results are cached based on cache_ttl_seconds:

0: No caching (default)
> 0: Cache successful results for specified seconds
AgentSpawn hooks are never cached

---

CLI commands
This page provides a comprehensive reference for all Kiro CLI commands and their arguments.

Global arguments
These arguments work with any Kiro CLI command:

Argument	Short	Description
--verbose	-v	Increase logging verbosity (can be repeated: -v, -vv, -vvv)
--agent	-v	Start a conversation using a specific custom agent configuration
--help	-h	Show help information
--version	-V	Show version information
--help-all		Print help for all subcommands
Commands
kiro-cli agent
Manage agent configurations. Agent name is now a positional argument for create, edit, and other subcommands.

Syntax:

bash

kiro-cli agent [SUBCOMMAND] [AGENT_NAME] [OPTIONS]
Subcommands:

Subcommand	Description
list	List the available agents
create <name>	Create an agent config (name is positional argument, v1.26.0+)
edit [name]	Edit an existing agent config (defaults to current agent if no name provided, v1.26.0+)
validate	Validate a config with the given path
migrate	Migrate profiles to agents (potentially destructive to existing agents)
set-default	Define a default agent to use when starting a session
Examples:

bash

kiro-cli agent list

# v1.26.0+: Agent name as positional argument
kiro-cli agent create my-agent
kiro-cli agent edit my-agent
kiro-cli agent edit  # Defaults to current agent

# Previous syntax (still supported)
kiro-cli agent validate ./my-agent.json
kiro-cli agent set-default my-agent
New in v1.26.0:

Agent name is now a positional argument (e.g., kiro-cli agent create my-agent instead of --name my-agent)
edit command defaults to editing the current agent when no argument is provided
kiro-cli chat
Start an interactive chat session with Kiro. When no subcommand is specified, kiro defaults to kiro-cli chat.

Syntax:

bash

kiro-cli chat [OPTIONS] [INPUT]
Arguments:

Argument	Description
--no-interactive	Print first response to STDOUT without interactive mode
--resume / -r	Resume the previous conversation from this directory
--resume-picker	Open interactive session picker to choose which session to resume
--list-sessions	List all saved chat sessions for the current directory
--list-models	Display available models
--delete-session <ID>	Delete a saved chat session by ID
--agent	Specify which agent to use
--trust-all-tools	Allow the model to use any tool without confirmation
--trust-tools	Trust only specified tools (comma-separated list)
--require-mcp-startup	Exit with code 3 if any MCP server fails to start
--wrap	Line wrapping mode: always, never, or auto (default)
INPUT	The first question to ask (positional argument)
Examples:

bash

# Start interactive chat
kiro-cli 

# Ask a question directly
kiro-cli chat "How do I list files in Linux?"

# Non-interactive mode with trusted tools
kiro-cli chat --no-interactive --trust-all-tools "Show me the current directory"

# Resume previous conversation
kiro-cli chat --resume

# Open session picker to choose which session to resume
kiro-cli chat --resume-picker

# List all saved sessions
kiro-cli chat --list-sessions

# List available models (plain text)
kiro-cli chat --list-models

# List available models (JSON output for scripting)
kiro-cli chat --list-models --format json

# Use specific agent
kiro-cli chat --agent my-agent "Help me with AWS CLI"
kiro-cli translate
Translate natural language instructions to executable shell commands using AI.

Syntax:

bash

kiro-cli translate [OPTIONS] [INPUT...]
Arguments:

Argument	Short	Description
--n	-n	Number of completions to generate (max 5)
INPUT		Natural language description (positional arguments)
Examples:

bash

kiro-cli translate "list all files in the current directory"
kiro-cli translate "find all Python files modified in the last week"
kiro-cli translate "compress all log files older than 30 days"
kiro-cli translate -n 3 "search for text in files"
kiro-cli doctor
Diagnose and fix common installation and configuration issues.

Syntax:

bash

kiro-cli doctor [OPTIONS]
Arguments:

Argument	Short	Description
--all	-a	Run all diagnostic tests without fixes
--strict	-s	Error on warnings
--format	-f	Output format: plain, json, json-pretty
Examples:

bash

kiro-cli doctor
kiro-cli doctor --all
kiro-cli doctor --strict
kiro-cli update
Update Kiro CLI to the latest version.

Syntax:

bash

kiro-cli update [OPTIONS]
Arguments:

Argument	Short	Description
--non-interactive	-y	Don't prompt for confirmation
--relaunch-dashboard		Relaunch dashboard after update (default: true)
Examples:

bash

kiro-cli update
kiro-cli update --non-interactive
kiro-cli theme
Get or set the visual theme for the autocomplete dropdown menu.

Syntax:

bash

kiro-cli theme [OPTIONS] [THEME]
Arguments:

Argument	Description
--list	List all available themes
--folder	Show the theme directory path
THEME	Theme name: dark, light, system
Examples:

bash

kiro-cli theme --list
kiro-cli theme dark
kiro-cli theme light
kiro-cli theme system
kiro-cli integrations
Manage system integrations for Kiro.

Syntax:

bash

kiro-cli integrations [SUBCOMMAND] [OPTIONS]
Subcommands:

Subcommand	Description
install [integration]	Install an integration (e.g., kiro-command-router)
uninstall [integration]	Uninstall an integration
reinstall [integration]	Reinstall an integration
status	Check integration status
Options:

--silent / -s: Suppress status messages
--format / -f: Output format (for status command)
Examples:

bash

# Install kiro command router (v1.26.0+)
kiro-cli integrations install kiro-command-router

# Check integration status
kiro-cli integrations status

# Uninstall silently
kiro-cli integrations uninstall --silent
Kiro Command Router (v1.26.0+)
The kiro command router is a unified entry point that routes the kiro command between CLI and IDE based on your preference.

Problem it solves: By default, the kiro command launches Kiro IDE. Many users prefer it to launch the CLI since they use the app icon to open the IDE.

Installation:

bash

# Install the router
kiro-cli integrations install kiro-command-router

# Set CLI as the default
kiro set-default cli

# Or set IDE as the default
kiro set-default ide
After installation:

kiro - Launches your default (CLI or IDE)
kiro-cli - Always launches CLI
kiro ide - Always launches IDE
Use cases:

CLI-focused workflows where you primarily use the terminal
Quick access to CLI without typing kiro-cli every time
Flexibility to switch defaults based on your current project or workflow
kiro-cli inline
Manage inline suggestions (ghost text) that appear as you type.

Syntax:

bash

kiro-cli inline [SUBCOMMAND] [OPTIONS]
Subcommands:

Subcommand	Description
enable	Enable inline suggestions
disable	Disable inline suggestions
status	Show current status
set-customization	Select a customization model
show-customizations	Show available customizations
Examples:

bash

kiro-cli inline enable
kiro-cli inline disable
kiro-cli inline status
kiro-cli inline set-customization
kiro-cli inline show-customizations --format json
kiro-cli login
Authenticate with Kiro CLI service using Builder ID, Identity Center, or social login (Google, GitHub).

Syntax:

bash

kiro-cli login [OPTIONS]
Options:

Option	Description
--license <TYPE>	License type: pro (Identity Center) or free (Builder ID, Google, GitHub)
--identity-provider <URL>	Identity provider URL (for Identity Center)
--region <REGION>	AWS region (for Identity Center)
--social <PROVIDER>	Social provider: google or github
--use-device-flow	Force device flow (for remote/SSH environments)
--verbose	Increase logging verbosity (can be repeated)
--help	Print help information
Authentication Methods:

Local Environment:

Opens browser for unified auth portal
Select authentication method interactively
Login-selection flags (e.g., --license, --social) are generally ignored locally; the browser flow controls the method
Remote Environment (SSH/Terminal):

Uses device flow automatically
Shows device code and URL
Complete authentication on another device
CLI polls for completion
Examples:

bash

# Basic login (opens browser locally, shows device code remotely)
kiro-cli login

# Identity Center login
kiro-cli login --license pro --identity-provider https://my-org.awsapps.com/start --region us-east-1

# Social login
kiro-cli login --social google

# Force device flow (useful for SSH sessions)
kiro-cli login --use-device-flow
Troubleshooting:

Already logged in error: Logout first with kiro-cli logout
Browser doesn't open: Use --use-device-flow flag
Authentication timeout: Restart the login process
Identity Center fails: Verify URL and region with your administrator
kiro-cli logout
Sign out of Kiro CLI service and clear authentication credentials.

Syntax:

bash

kiro-cli logout
Options:

Option	Short	Description
--verbose	-v	Increase logging verbosity (can be repeated)
--help	-h	Print help information
What Gets Cleared:

Authentication tokens
Session credentials
User profile information
What's Preserved:

Agent configurations
Saved conversations
Settings
MCP server configurations
Example:

bash

kiro-cli logout
Output:


You are now logged out
Run kiro-cli login to log back in to Kiro CLI
Note: Logout is user-wide and affects all workspaces.

kiro-cli whoami
Display information about the current user and authentication status, including your email address for Builder ID, IAM Identity Center, and Social login types.

Syntax:

bash

kiro-cli whoami [OPTIONS]
Options:

Option	Short	Description
--format	-f	Output format: plain, json, json-pretty
--verbose	-v	Increase logging verbosity (can be repeated)
--help	-h	Print help information
Output Information:

Username/user ID
Authentication method (Builder ID, Identity Center, Social)
Session status
Profile information
Examples:

bash

# Check current user
kiro-cli whoami
# Logged in with Builder ID
# Email: user@example.com

kiro-cli whoami --format json
kiro-cli whoami --format json-pretty
Example Output (Identity Center):


Logged in with IAM Identity Center (https://my-org.awsapps.com/start)

Profile:
Q-Dev-Amazon-Profile
arn:aws:codewhisperer:us-east-1:...:profile/...
Example Output (Builder ID):


Logged in with Builder ID

Profile:
builder-id-username
Troubleshooting:

Not logged in error: Login with kiro-cli login
kiro-cli settings
Manage kiro-cli configuration settings.

Syntax:

bash

kiro-cli settings [SUBCOMMAND] [OPTIONS] [KEY] [VALUE]
Arguments:

Argument	Short	Description
--delete	-d	Delete a setting
--format	-f	Output format: plain, json, json-pretty
KEY		Setting key (positional)
VALUE		Setting value (positional)
Subcommands:

Subcommand	Description
open	Open settings file in default editor
list	List configured settings
list --all	List all available settings with descriptions
Examples:

bash

# View all settings
kiro-cli settings list

# View all available settings
kiro-cli settings list --all

# Get a specific setting
kiro-cli settings telemetry.enabled

# Set a setting
kiro-cli settings telemetry.enabled true

# Delete a setting
kiro-cli settings --delete chat.defaultModel

# Open settings file
kiro-cli settings open

# JSON output
kiro-cli settings list --format json-pretty
kiro-cli diagnostic
Run diagnostic tests and generate system information report for troubleshooting.

Syntax:

bash

kiro-cli diagnostic [OPTIONS]
Options:

Option	Short	Description
--format	-f	Output format: plain, json, json-pretty (default: plain)
--force		Force limited diagnostic output (faster, works without app running)
--verbose	-v	Increase logging verbosity (can be repeated)
--help	-h	Print help information
The plain format outputs Markdown-formatted text.

Behavior:

Without --force: Requires Kiro CLI app to be running (use kiro-cli launch first). Generates comprehensive diagnostics by connecting to the running app.
With --force: Standalone command that works without the app running. Generates limited but faster diagnostics.
Output Information:

The diagnostic report includes:

System information (OS, architecture, memory)
Kiro CLI version and build details
Configuration status
Environment variables
Installed dependencies
Potential issues
Examples:

bash

# Generate full diagnostic report
kiro-cli diagnostic

# JSON output
kiro-cli diagnostic --format json-pretty

# Limited output (faster)
kiro-cli diagnostic --force
Example Output (TOML format):

toml

[q-details]
version = "1.23.0"
hash = "97d58722cd90f6d3dda465f6462ee4c6dc104b22"
date = "2025-12-18T16:49:27.015389Z (4d ago)"
variant = "full"

[system-info]
os = "macOS 15.7.1 (24G231)"
chip = "Apple M1 Pro"
total-cores = 10
memory = "32.00 GB"

[environment]
cwd = "/Users/user/project"
cli-path = "/Users/user/.cargo/bin/kiro-cli"
os = "Mac"
shell-path = "/bin/bash"
shell-version = "5.1.16"
terminal = "iTerm2"
install-method = "cargo"

[env-vars]
PATH = "..."
SHELL = "/bin/zsh"
TERM = "xterm-256color"
Troubleshooting:

"Kiro CLI app is not running" error: Launch the app with kiro-cli launch or use --force flag for standalone diagnostics
Diagnostic hangs: Use --force for faster limited output
Permission errors: Run with appropriate permissions or ignore errors
Use Cases:

Troubleshooting installation issues
Providing information to support
Verifying environment configuration
Checking for potential problems
kiro-cli issue
Create a GitHub issue for feedback or bug reports.

Syntax:

bash

kiro-cli issue [OPTIONS] [DESCRIPTION...]
Arguments:

Argument	Short	Description
--force	-f	Force issue creation
DESCRIPTION		Issue description (positional)
Examples:

bash

kiro-cli issue
kiro-cli issue "Autocomplete not working in zsh"
kiro-cli version
Display version information and changelog.

Syntax:

bash

kiro-cli version [OPTIONS]
Arguments:

Argument	Description
--changelog	Show changelog for current version
--changelog=all	Show changelog for all versions
--changelog=x.x.x	Show changelog for specific version
Examples:

bash

kiro-cli version
kiro-cli version --changelog
kiro-cli version --changelog=all
kiro-cli version --changelog=1.5.0
kiro-cli mcp
Manage Model Context Protocol (MCP) servers.

Syntax:

bash

kiro-cli mcp [SUBCOMMAND] [OPTIONS]
Subcommands:

kiro-cli mcp add
Add or replace a configured MCP server.

Arguments:

Argument	Description
--name	Server name (required)
--command	Launch command (required)
--scope	Scope: workspace or global
--env	Environment variables: key1=value1,key2=value2
--timeout	Launch timeout in milliseconds
--force	Overwrite existing server
Example:

bash

kiro-cli mcp add --name my-server --command "node server.js" --scope workspace
kiro-cli mcp remove
Remove an MCP server.

Arguments:

Argument	Description
--name	Server name (required)
--scope	Scope: workspace or global
Example:

bash

kiro-cli mcp remove --name my-server --scope workspace
kiro-cli mcp list
List configured MCP servers.

Syntax:

bash

kiro-cli mcp list [SCOPE]
Example:

bash

kiro-cli mcp list
kiro-cli mcp list workspace
kiro-cli mcp list global
kiro-cli mcp import
Import server configuration from a file.

Arguments:

Argument	Description
--file	Configuration file (required)
--force	Overwrite existing servers
SCOPE	Scope: workspace or global
Example:

bash

kiro-cli mcp import --file config.json workspace
kiro-cli mcp status
Get the status of an MCP server.

Arguments:

Argument	Description
--name	Server name (required)
Example:

bash

kiro-cli mcp status --name my-server
Session management
Kiro CLI automatically saves all chat sessions on every conversation turn. You can resume from any previous chat session at any time.

From the command line
bash

# Resume the most recent chat session
kiro-cli chat --resume

# Interactively pick a chat session to resume
kiro-cli chat --resume-picker

# List all saved chat sessions for the current directory
kiro-cli chat --list-sessions

# Delete a saved chat session
kiro-cli chat --delete-session <SESSION_ID>
From within a chat session
Use the /chat command to manage sessions:

bash

# Start a fresh conversation (saves current session automatically)
/chat new

# Start a fresh conversation with an initial prompt
/chat new <PROMPT>

# Resume a chat session (interactive selector)
/chat resume

# Save current session to a file
/chat save <FILE_PATH>

# Load a session from a file
/chat load <FILE_PATH>
The .json extension is optional when loading - Kiro will try both with and without the extension.

Custom session storage
You can use custom scripts to control where chat sessions are saved to and loaded from. This allows you to store sessions in version control systems, cloud storage, databases, or any custom location.

bash

# Save session via custom script (receives JSON via stdin)
/chat save-via-script <SCRIPT_PATH>

# Load session via custom script (outputs JSON to stdout)
/chat load-via-script <SCRIPT_PATH>
Tips:

Session IDs are UUIDs that uniquely identify each chat session
Sessions are stored per directory, so each project has its own set of sessions
The most recently updated sessions appear first in the list
Log files
Kiro CLI maintains log files for troubleshooting:

Locations:

macOS: $TMPDIR/kiro-log/
Linux: $XDG_RUNTIME_DIR or /tmp/kiro-log/
Environment Variables:

Control logging behavior with these environment variables:

Variable	Values	Description
KIRO_LOG_LEVEL	error, warn, info, debug, trace	Set logging verbosity (default: error)
KIRO_LOG_NO_COLOR	1, true, yes	Disable colored log output (v1.26.0+)
Log Levels:

Set via KIRO_LOG_LEVEL environment variable:

error: Only errors (default)
warn: Warnings and errors
info: Info, warnings, and errors
debug: Debug info and above
trace: All messages including detailed traces
Examples:

bash

# Enable debug logging
export KIRO_LOG_LEVEL=debug
kiro-cli chat

# Disable colored output (useful for CI/CD, v1.26.0+)
export KIRO_LOG_NO_COLOR=1
kiro-cli chat

# Combined
export KIRO_LOG_LEVEL=debug
export KIRO_LOG_NO_COLOR=true
kiro-cli chat

# For fish shell
set -x KIRO_LOG_LEVEL debug
set -x KIRO_LOG_NO_COLOR 1
kiro-cli chat
New in v1.26.0: KIRO_LOG_NO_COLOR environment variable to disable colored log output, useful for CI/CD pipelines and log file processing.

Warning: Log files may contain sensitive information including file paths, code snippets, and command outputs. Be cautious when sharing logs.

