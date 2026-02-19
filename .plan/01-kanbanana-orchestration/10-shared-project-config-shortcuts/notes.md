# Phase 10 Notes

## Decision
Shortcuts belong in global runtime config so Kanbanana does not write state into project directories.

## Implemented Early
1. Extended `~/.kanbanana/config.json` to store shortcut entries (`id`, `label`, `command`, optional `icon`).
2. Added runtime config API support for reading/updating shortcuts.
3. Added shortcut run endpoint with timeout and output capture.
4. Added shortcut editor in runtime settings dialog and top-bar shortcut buttons.
5. Added inline output preview panel after shortcut execution.

## Risks
1. Arbitrary command execution needs clear warnings and permission model.
2. Cross-platform command compatibility may vary by shell.
