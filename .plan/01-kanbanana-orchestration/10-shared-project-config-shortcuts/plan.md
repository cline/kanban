# Phase 10 Plan: Global Runtime Config and Shortcuts

## Goal
Support user-level runtime behavior through global `~/.kanbanana` configuration.

## Scope
1. Global config file under `~/.kanbanana/`.
2. Script shortcut buttons with icon, label, and command.
3. Run/test/custom command examples.
4. Optional command output preview panel.
5. Import and apply config on runtime startup.

## Out of Scope
1. Complex secret management for shared commands.
2. Global usage analytics.

## Test Gate
1. Configure two shortcut buttons in global `~/.kanbanana/config.json`.
2. Run commands from UI and view output preview.
3. Start Kanbanana from two different local repos and verify the same shortcut setup appears.

## Exit Criteria
1. Global shortcuts are portable and reliable across local repos.
2. Users get one consistent automation surface without writing state into project folders.
