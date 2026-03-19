# Cross-platform Compatibility Remediation Plan

Date: March 14, 2026

Purpose: define the concrete work needed to make Kanban reliably cross-compatible across macOS, Linux, and Windows.

## Scope

This plan focuses on runtime and user-facing compatibility for:

- CLI behavior
- web UI actions that call runtime commands
- worktree creation and cleanup
- hook metadata behavior
- shell and process behavior
- CI coverage for non-macOS environments

This plan does not attempt to guarantee every agent binary behaves identically on all OSes. It covers Kanban-owned behavior and known gaps.

## Current status summary

- Already fixed: browser auto-open no longer crashes when `xdg-open` is missing on Linux.
  - Commit: `1aec3f4`
  - Files: `src/server/browser.ts`, `src/cli.ts`, `test/runtime/browser.test.ts`
- Completed: transcript source inference now normalizes Windows and Unix path separators.
  - Commit: `fe1eee9`
  - Files: `src/commands/hooks.ts`, `test/runtime/hooks-source-inference.test.ts`
- Completed: project directory picker now supports Windows PowerShell (`powershell` with `pwsh` fallback).
  - Commit: `d1e35a4`
  - Files: `src/server/directory-picker.ts`, `test/runtime/directory-picker.test.ts`
- Completed: workspace open targets and commands are now platform-aware in web UI.
  - Commit: `1f793a5`
  - Files: `web-ui/src/utils/open-targets.ts`, `web-ui/src/hooks/use-open-workspace.ts`, `web-ui/src/utils/open-targets.test.ts`
- Completed: OpenCode path detection now supports Windows AppData and LocalAppData candidates.
  - Commit: `d92b2a6`
  - Files: `src/terminal/opencode-paths.ts`, `src/terminal/task-start-setup-detection.ts`, `src/terminal/agent-session-adapters.ts`
- Completed: runtime timeout termination now uses platform-aware behavior with `tree-kill` for Windows process trees.
  - Commit: `845e112`
  - Files: `src/server/process-termination.ts`, `src/cli.ts`, `test/runtime/process-termination.test.ts`
- Completed: ignored-path mirroring now behaves as best-effort and never blocks worktree setup when symlink creation fails.
  - Commit: `5dac7f9`
  - Files: `src/workspace/task-worktree.ts`, `test/runtime/task-worktree-mirroring.test.ts`, `test/integration/task-worktree.integration.test.ts`
- Current overall status: partial cross-compatibility with several high-impact gaps on Windows and Linux.

## Findings backlog

| ID | Severity | Area | Affected OS | Status |
| --- | --- | --- | --- | --- |
| CP-001 | high | Workspace open command generation in web UI is macOS-only | Windows, Linux | completed |
| CP-002 | high | System folder picker has no Windows path and weak Linux fallback | Windows, Linux | completed |
| CP-003 | high | Worktree ignored-path mirroring should be best effort on Windows | Windows | completed |
| CP-004 | medium | Hook transcript path source inference assumes forward slashes | Windows | completed |
| CP-005 | medium | OpenCode config and state path probing is Unix-centric | Windows | completed |
| CP-006 | medium | Runtime command execution uses shell and SIGTERM behavior that differs on Windows | Windows | completed |
| CP-007 | low | `file://` URL construction in web UI is path-format fragile | Windows | pending |
| CP-008 | medium | CI does not run on Windows or macOS | Windows, macOS | pending |

## Detailed remediation items

## CP-001: Make workspace open actions OS-aware

Problem:

- `web-ui/src/utils/open-targets.ts` builds commands using `open` and `open -a`, which is macOS-only.
- The resulting command is executed by runtime `runCommand`, so this silently fails on Windows/Linux.

Files:

- `web-ui/src/utils/open-targets.ts`
- `web-ui/src/hooks/use-open-workspace.ts`
- `src/cli.ts` (`runScopedCommand` execution path)

Implementation plan:

1. Add an OS-aware command builder API, for example:
   - `buildOpenCommand(targetId, path, platform)`
2. Add platform-specific command maps:
   - macOS: current `open` and `open -a`
   - Linux: `xdg-open` default, app-specific launches only where realistic
   - Windows: `start "" <path>` for file manager/editor default, plus optional app-specific commands if binary availability can be verified
3. In UI, expose only valid targets for the detected platform to avoid presenting unsupported options.
4. Keep command quoting platform-safe.

Test plan:

- Unit tests for command generation per platform.
- Ensure no macOS-only commands are generated for Windows/Linux.
- Smoke test through `runtime.runCommand` mutation path.

Acceptance criteria:

- Opening workspace from UI works on all three OSes.
- UI does not show broken targets for a given OS.

## CP-002: Add robust project directory picker support

Problem:

- `pickDirectoryPathFromSystemDialog()` handles only:
  - macOS via `osascript`
  - Linux via `zenity`
- Windows currently returns `null`.
- Linux returns `null` if `zenity` is not installed.

Files:

- `src/cli.ts`
- `src/trpc/projects-api.ts`
- `web-ui/src/hooks/use-project-navigation.ts`

Implementation plan:

1. Add Windows picker implementation via PowerShell:
   - `Add-Type -AssemblyName System.Windows.Forms`
   - `FolderBrowserDialog`
2. Add Linux fallback chain:
   - `zenity`
   - `kdialog`
   - if unavailable, return a specific error message instructing manual path entry flow
3. Improve API response for picker failures to distinguish:
   - user canceled
   - picker unavailable
   - execution error
4. In UI, show clear toast on picker unavailable and prompt next steps.

Test plan:

- Unit test picker command selection and parse behavior.
- Mocked tests for canceled vs unavailable vs success cases.

Acceptance criteria:

- Windows users can pick a folder from UI.
- Linux users without `zenity` get an actionable fallback path.

## CP-003: Make ignored-path mirroring best effort on Windows

Problem:

- `src/workspace/task-worktree.ts` directly calls `symlink(source, target, type)`.
- On Windows, symlink creation often requires admin privileges or Developer Mode.
- Mirroring ignored paths is an optimization, not a requirement for task worktree correctness.
- Current behavior can fail the worktree path due to an optional optimization.

Files:

- `src/workspace/task-worktree.ts`
- `test/integration/task-worktree.integration.test.ts`

Implementation plan:

1. Introduce a helper such as `tryMirrorIgnoredPath(...)` that returns success or skip.
2. On Windows:
   - Attempt symlink optimistically.
   - If symlink fails with permission or unsupported errors, skip mirroring that path and continue.
   - Do not fail task worktree creation when mirroring fails.
3. Keep `.git/info/exclude` sync logic for paths that are mirrored.
4. Keep behavior non-blocking if symlink creation fails while mirroring ignored paths.
5. Preserve idempotency when rerunning ensure flow.

Test plan:

- Unit tests that simulate symlink errors and verify worktree creation still succeeds.
- Integration test coverage for best-effort skip behavior.
- Run worktree integration tests on Windows CI.

Acceptance criteria:

- Worktree creation succeeds on default Windows setups without requiring admin.
- Mirroring failure does not abort worktree creation.
- Mirroring failures do not abort worktree creation.

## CP-004: Normalize transcript paths before source inference

Problem:

- `src/commands/hooks.ts` infers source using `transcriptPath.includes("/.claude/")` and `"/.factory/"`.
- Windows paths often use backslashes, so inference can fail.

Files:

- `src/commands/hooks.ts`
- related hook metadata tests

Implementation plan:

1. Normalize path once for comparisons, for example:
   - `const normalizedPath = transcriptPath.replaceAll("\\", "/").toLowerCase();`
2. Perform source checks on normalized path.
3. Keep behavior unchanged for existing macOS/Linux paths.

Test plan:

- Add tests for Windows style path inputs.
- Confirm existing tests still pass.

Acceptance criteria:

- Source inference returns the same result for equivalent slash and backslash paths.

## CP-005: Add Windows path probes for OpenCode detection

Problem:

- OpenCode config/model detection checks Unix paths under `~/.config`, `~/.opencode`, `~/.local/state`, `~/.local/share`.
- Windows AppData paths are not probed.

Files:

- `src/terminal/task-start-setup-detection.ts`
- `src/terminal/agent-session-adapters.ts`

Implementation plan:

1. Add path candidate helpers for OpenCode that include:
   - `%APPDATA%\\opencode\\...`
   - `%LOCALAPPDATA%\\opencode\\...`
2. Reuse shared helper from both files to avoid divergence.
3. Preserve current explicit override behavior (`OPENCODE_CONFIG`).

Test plan:

- Unit tests for candidate path generation with mocked env.
- Tests that verify fallback ordering.

Acceptance criteria:

- OpenCode config and model detection works with typical Windows install paths.

## CP-006: Tighten runtime command execution portability

Problem:

- `src/cli.ts` uses `spawn(command, { shell: true })` and timeout `child.kill("SIGTERM")`.
- On Windows, shell semantics and signal behavior differ.

Files:

- `src/cli.ts`
- any tests covering runtime command execution

Implementation plan:

1. Clarify command execution contract by OS.
2. For timeout handling:
   - Windows: `child.kill()` and optional tree-kill fallback if needed
   - Unix: keep signal-based behavior
3. Add platform-aware execution helper so behavior is explicit and testable.

Test plan:

- Unit tests for timeout and exit handling with mocked child process events.
- Add targeted Windows CI test for a long-running command timeout.

Acceptance criteria:

- Timeout and error behavior is deterministic on Windows and Linux.

## CP-007: Use robust file URL generation in web UI

Problem:

- UI currently does `window.open(`file://${path}`)`.
- Windows path formatting can produce invalid file URLs.

Files:

- `web-ui/src/components/runtime-settings-dialog.tsx`

Implementation plan:

1. Move file URL creation to runtime and return URL-safe strings, or use a dedicated path-to-file-url utility in the web app boundary where available.
2. Ensure encoding for spaces and special characters.

Test plan:

- Unit test URL output for Windows and Unix paths.

Acceptance criteria:

- Clicking config path opens correctly on Windows and Unix.

## CP-008: Add multi-OS CI coverage

Problem:

- Current workflow runs only on `ubuntu-latest`.
- Windows and macOS regressions are not caught in CI.

Files:

- `.github/workflows/test.yml`
- possibly related workflow includes

Implementation plan:

1. Add matrix for at least:
   - `ubuntu-latest`
   - `windows-latest`
   - optional `macos-latest` for parity with local dev environment
2. Keep fail-fast false and capture OS-specific failures.
3. Split or guard tests that require Linux-only tools where needed.

Test plan:

- Validate workflow executes and passes on all target OSes.

Acceptance criteria:

- PR CI reports cross-platform status before merge.

## Proposed implementation order for incremental commits

Recommended sequence:

1. CP-004 transcript path normalization
2. CP-002 project picker support
3. CP-001 workspace open command portability
4. CP-005 OpenCode Windows path probes
5. CP-006 runtime command execution portability hardening
6. CP-003 worktree symlink fallback on Windows
7. CP-007 file URL robustness
8. CP-008 CI matrix expansion

Why this order:

- Starts with low-risk correctness fixes.
- Unblocks core user flows early.
- Lands high-impact worktree changes after supporting command/path foundations are in place.

## Validation checklist for each commit

For each item above:

1. Add or update tests first where feasible.
2. Run `npm run check`.
3. If web UI files changed, also run `npm --prefix web-ui run test` and `npm --prefix web-ui run typecheck`.
4. On platform-specific changes, run the relevant job or local smoke test for that OS.

## Open unknowns that require real platform runs

- Windows behavior of symlink fallback for all ignored path shapes.
- Linux behavior when neither `zenity` nor `kdialog` exists.
- Exact Windows shell timeout behavior for all command types used by runtime shortcuts.
- Agent binary availability and path assumptions outside Kanban control.

## Progress tracking template

Use this section to track progress as work lands.

| ID | Owner | Branch | PR | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| CP-001 | unassigned |  |  | completed | commit `1f793a5` |
| CP-002 | unassigned |  |  | completed | commit `d1e35a4` |
| CP-003 | unassigned |  |  | completed | commit `5dac7f9` |
| CP-004 | unassigned |  |  | completed | commit `fe1eee9` |
| CP-005 | unassigned |  |  | completed | commit `d92b2a6` |
| CP-006 | unassigned |  |  | completed | commit `845e112` |
| CP-007 | unassigned |  |  | pending |  |
| CP-008 | unassigned |  |  | pending |  |
