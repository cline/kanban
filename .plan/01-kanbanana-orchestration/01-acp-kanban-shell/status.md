# Phase 01 Status

## Current State
- Status: in progress
- Progress: 70 percent

## Next Tasks
1. Add CLI/runtime local server path so `kanbanana` launches browser UI directly.
2. Replace mock ACP turn runner with real ACP SDK subprocess transport.
3. Connect real repo file tree and git diff from runtime API instead of session-derived artifacts.
4. Validate full phase gate from CLI launch through task completion with persistence.

## Blockers
- None.

## Resume From Here
- Start with CLI boot path and ACP adapter contract, reusing the UI session lifecycle that is now wired.
