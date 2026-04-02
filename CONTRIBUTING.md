# Contributing to AgenticKanban (Fork)

This is a fork of [cline/kanban](https://github.com/cline/kanban). We regularly sync with upstream to pull in bug fixes and new features. **All contributors must follow the fork sync principles below to preserve our ability to merge from upstream without painful conflicts.**

## Fork Sync Principles

### 1. Keep internal IDs unchanged; override display only

Never rename upstream enum values, column IDs, or internal identifiers. If the display label needs to change, modify only the `title` string in `BOARD_COLUMNS` (or equivalent display-layer code), not the `id`.

For example, the internal column ID `"trash"` must remain `"trash"` even though we display it as "Done." This keeps every upstream reference to `"trash"` conflict-free.

### 2. Add new modules; minimize edits to upstream files

These upstream files change frequently and are high-conflict zones:

| File | Upstream churn |
|------|---------------|
| `src/core/api-contract.ts` | ~43 commits/month |
| `src/commands/hooks.ts` | ~16 commits/month |
| `src/prompts/append-system-prompt.ts` | ~14 commits/month |
| `src/state/workspace-state.ts` | ~13 commits/month |

**Rules for these files:**
- Additions of 1-2 lines (e.g., adding a value to an enum) are acceptable
- Multi-line modifications, refactors, or rearrangements are not — move that logic to a new file
- Never delete or rename upstream code in these files

Place new logic in dedicated directories (e.g., `src/qa/`, `src/validation/`) that upstream will never touch.

### 3. Wrap, don't modify upstream functions

If you need to change how an upstream function behaves, create a wrapper in a new file rather than editing the original:

```typescript
// src/qa/lifecycle.ts (our file — never conflicts)
import { trashTaskAndGetReadyLinkedTaskIds } from "../core/task-board-mutations";

export function completeTaskWithValidation(board, taskId, now) {
  // our validation logic here
  return trashTaskAndGetReadyLinkedTaskIds(board, taskId, now);
}
```

Do not rename upstream functions, change their signatures, or alter their internal logic.

### 4. Don't rename upstream symbols

Renaming functions, types, variables, or file names that exist in upstream creates conflicts on every sync. If a name is misleading (e.g., `trashTask` for completed work), create an alias or wrapper — don't rename the original.

### 5. Use our own config namespace

Our configuration (validation commands, rubrics, holdout scenarios) lives in `.factory/` or a dedicated directory, not in upstream's config files (`runtime-config.ts`). This way upstream config shape changes never conflict with ours.

### 6. Use hooks/events as integration seams

The existing hook events (`to_review`, `to_in_progress`, `activity`) are the natural extension points. Our QA orchestration should subscribe to these from new modules rather than modifying `hooks.ts` inline. If new events are needed (e.g., `to_qa`), add them with minimal changes to the upstream file.

### 7. Tag fork-specific changes in commits

Commits that modify upstream files should use the `fork:` prefix so they are easy to identify during merge conflict resolution:

```
fork: add qa column to board column enum
fork: add QA entry to BOARD_COLUMNS array
```

This makes it clear during `git merge upstream/main` which lines are ours and must be kept.

### 8. Sync with upstream regularly

```bash
git fetch upstream
git merge upstream/main
```

Merge (don't rebase) upstream into our main. Frequent small merges are far easier than infrequent large ones.

---

# Contributing to Kanban (Upstream)

The following is the upstream contribution guide, preserved for reference.

Thanks for your interest in contributing to Kanban! This project is in research preview, and we're focused on making the existing feature set rock-solid across platforms and agents before expanding scope. Community help is invaluable here.

## What We're Looking For

Kanban currently supports Claude, Codex, Gemini, OpenCode, Droid, and Cline as runtime agents, and runs on macOS, Linux, and Windows. The surface area for cross-compatibility issues is large, and that's where contributions have the most impact.

We are actively looking for help with:

- Cross-platform support: fixing bugs and inconsistencies across macOS, Linux, and Windows (terminal behavior, path handling, symlinks, shell detection, etc.)
- Agent compatibility: adding support for new CLI agents, fixing integration issues with existing ones, and improving agent detection/lifecycle management
- Bug fixes: anything that makes the current feature set more stable and reliable
- Test coverage: adding tests for untested paths, especially platform-specific and agent-specific behavior

We are not currently accepting feature PRs. If you have a feature idea, please open a [Feature Request discussion](https://github.com/cline/kanban/discussions/categories/feature-requests) instead. We may incorporate it into the roadmap, but the priority right now is stability and compatibility.

## Reporting Bugs

Before opening a new issue, search [existing issues](https://github.com/cline/kanban/issues) to avoid duplicates. When filing a bug, include:

- Your OS and version
- Which CLI agent you're using (and its version)
- Steps to reproduce
- Expected vs. actual behavior
- Any relevant terminal output or screenshots

If you discover a security vulnerability, please report it privately using [GitHub's security advisory tool](https://github.com/cline/kanban/security/advisories/new).

## Before Contributing

For bug fixes and compatibility improvements, open an issue first (unless it's a trivial fix like a typo or minor correction). Describe the problem and your proposed approach so we can align before you invest time.

PRs without a corresponding issue may be closed.

## Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/cline/kanban.git
   cd kanban
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the dev server:
   ```bash
   npm run dev        # Backend watch mode
   npm run web:dev    # Frontend Vite dev server (in a separate terminal)
   ```

4. Before submitting a PR, make sure both of these pass locally:
   ```bash
   npm run check      # Lint + typecheck + tests
   npm run build      # Full production build
   ```

## Writing and Submitting Code

1. Keep PRs small and focused. One bug fix or one compatibility improvement per PR. If your change touches multiple areas, split it into separate PRs.

2. Code quality:
   - No `any` types. Find the correct type from source or `node_modules`.
   - No inline or dynamic imports. Use standard top-level imports.
   - Write production-quality code, not prototypes.

3. Add tests for your changes. Run `npm run test` to verify everything passes.

4. Use [conventional commit](https://www.conventionalcommits.org/) format for commit messages (e.g., `fix(terminal):`, `feat(agents):`, `test:`). Reference the issue number with `fixes #123` or `closes #123` when applicable.


## Adding Support for a New CLI Agent

If you'd like to add support for a new CLI agent, open an issue first to discuss. A good agent integration PR typically includes:

- Agent detection (checking if the CLI is installed and available on PATH)
- Session startup and lifecycle management
- Side panel prompt injection for supported agents so the agent can interact with the board
- Terminal integration and hook support
- Tests covering the above

Look at the existing agent implementations in `src/` for reference. The agent list lives in `src/cli.ts` and the runtime abstractions are nearby.

## Philosophy

Kanban is in foundation mode. Favor clear primitives and good tooling over early complexity. Build extensibility into the core, then layer product features iteratively.

## Community

- [Discord](https://discord.gg/cline) (join the #kanban channel)
- [Feature Requests](https://github.com/cline/kanban/discussions/categories/feature-requests)
- [Issues](https://github.com/cline/kanban/issues)

## License

By submitting a pull request, you agree that your contributions will be licensed under the project's [Apache 2.0 license](./LICENSE).
