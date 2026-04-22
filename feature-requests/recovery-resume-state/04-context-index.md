# Context Index

This folder now follows a local Cavekit-style flow:

- `05-refs-existing-behavior.md`
  - brownfield source-of-truth notes from the current Kanban codebase
- `06-kit-recovery-resume-state.md`
  - requirements for the fork feature
- `01-scope.md`
  - branch scope and non-goals
- `02-ticket-index.md`
  - task graph and delegation breakdown
- `03-orchestration-prompt.md`
  - compact multi-agent execution prompt
- `07-validation.md`
  - validation-first gates and acceptance mapping
- `08-tracking.md`
  - living implementation ledger for the branch

Traversal order for implementation:
1. read `05-refs-existing-behavior.md`
2. read `06-kit-recovery-resume-state.md`
3. read `01-scope.md`
4. read `02-ticket-index.md`
5. read `07-validation.md`
6. update `08-tracking.md` during every implementation pass

Branch:
- `fork/feature-request/recovery-resume-state`

Design rule:
- this is a brownfield fork feature
- existing Kanban code is the behavioral source of truth
- the kit defines the intended fork delta from upstream
