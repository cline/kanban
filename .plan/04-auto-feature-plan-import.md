# Auto Feature Plan Import

## Overview
Automatically import feature plans from `.cline_task_plan` directory into the Kanban backlog.

## Problem Statement
Users want to use AI to generate feature plans (in `.cline_task_plan/*.md` files) and have Cline Kanban automatically import them as backlog tasks.

## File Format

The `.cline_task_plan` directory contains markdown files with the following format:

```markdown
---
title: Feature Title
priority: high|medium|low
---

# Feature Title

Detailed prompt/description of what this feature should do.

## Requirements
- Requirement 1
- Requirement 2

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
```

## Implementation Plan

### 1. Create Feature Plan Parser (src/state/feature-plan-parser.ts) ✅ DONE
- Parse frontmatter for title, priority
- Extract body as prompt for task
- Validate required fields (title, prompt)
- Return typed `FeaturePlan` object or error

### 2. Create Task Plan Watcher Service (src/state/feature-plan-watcher.ts) ✅ DONE
- Watch `.cline_task_plan` directory for new/modified files
- Use polling mechanism (5 second interval)
- Track processed files in a Set to avoid duplicates
- On new file detected: parse and create task in backlog
- Mark file as processed by renaming with `.processed` suffix

### 3. Integration with Workspace Registry
The watcher needs to start when a workspace is activated. Two approaches:

**Option A: Runtime Server Integration (Recommended)**
- Modify `src/server/runtime-server.ts` to create and manage watcher instances
- Start watcher when `setActiveWorkspace` is called
- Stop watcher when workspace is disposed
- Need access to `getWorkspacePathById` to get the workspace path

**Option B: Workspace API Extension**
- Add new endpoint to workspace API to enable/disable watching
- Frontend controls when to start watching

### 4. Create Tasks from Feature Plans
- Use existing `addTaskToColumn` function
- Use the feature plan's title and full body as the task prompt
- Get baseRef from workspace git state
- Generate unique task IDs

### 5. Error Handling
- Invalid file format: log warning, skip file
- Duplicate task: skip or update existing  
- File read errors: retry with backoff

## Files Created

```
src/state/
  feature-plan-parser.ts      # ✅ Created: Parse feature plan files
  feature-plan-watcher.ts    # ✅ Created: Watch directory and import plans
```

## Files to Modify

```
src/server/
  runtime-server.ts           # Add watcher initialization/cleanup
  workspace-registry.ts       # Add watcher management methods (optional)
```

## Key Integration Points

- `getWorkspacePathById(workspaceId)` from workspace registry
- `mutateWorkspaceState(cwd, mutate)` from workspace-state
- `addTaskToColumn(board, columnId, input, randomUuid)` from task-board-mutations

## Acceptance Criteria

- [ ] Feature plan files in `.cline_task_plan` are detected within 5 seconds
- [ ] Valid feature plans create tasks in the backlog
- [ ] Processed files are marked to avoid re-import
- [ ] Invalid files are logged and skipped gracefully
- [ ] Watcher starts when workspace loads
- [ ] Watcher stops when workspace unloads
- [ ] Git baseRef is resolved for new tasks
- [ ] Tasks created from feature plans are functional (can be started)

## Example Usage

1. User creates `.cline_task_plan/my-feature.md` with content:
```markdown
---
title: Add dark mode
---

# Add dark mode

Implement dark mode for the web UI. Should respect system preference.
```

2. Watcher detects new file within 5 seconds

3. Task created in backlog with:
   - Title: "Add dark mode"
   - Prompt: "Implement dark mode for the web UI. Should respect system preference."

4. File renamed to `.cline_task_plan/my-feature.md.processed` to mark as imported
