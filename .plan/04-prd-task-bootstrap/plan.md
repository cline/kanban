# PRD Task Bootstrap Plan

## Goal
Add a small PR-ready workflow that lets a user select a strategy/PRD markdown file from the current workspace, parse actionable items from it, and populate ordered backlog cards so work can begin immediately.

## Scope
1. In scope
   - create-dialog import UX for workspace markdown files
   - safe runtime API for reading markdown files from the workspace
   - markdown-to-task parsing utilities
   - preserving imported task order in backlog batch creation
   - focused tests for parsing, runtime API behavior, and ordered creation
2. Out of scope for this pass
   - dependency graph generation from PRD sections
   - automatic task starting on import without user review
   - rich markdown AST parsing or new third-party parser dependencies
   - changes to inline card creation outside the main create dialog

## Current Investigation Snapshot
1. `TaskCreateDialog` already supports multi-create by splitting prompt text into list items.
2. `useTaskEditor.handleCreateTasks` is the current multi-create source of truth, but backlog insertion currently reverses input order visually.
3. `TaskPromptComposer` already uses `workspace.searchFiles` through TRPC for workspace-scoped file discovery.
4. There is no dedicated workspace file-read API yet, so markdown import needs a new safe runtime surface.
5. Existing `.plan/<initiative>/plan.md` + `status.md` pairs are the repository convention for tracked initiatives.

## Decision Table
1. Import entry point
   - Decision: add import UI only to `web-ui/src/components/task-create-dialog.tsx`
   - Rationale: keeps the change tight and reuses the existing create/review flow
2. Supported file types
   - Decision: `.md`, `.markdown`, `.mdx`
   - Rationale: covers common PRD/strategy files without broad file-reading scope
3. Imported prompt source reference
   - Decision: append `@<source-path>` to each imported prompt when not already present
   - Rationale: preserves provenance and fits existing file reference conventions
4. Importable markdown content
   - Decision: import unchecked checklist items anywhere plus top-level bullet/numbered items under execution-like headings
   - Rationale: keeps extraction actionable and avoids pulling in scope/risk prose
5. Batch ordering
   - Decision: preserve source order visually in backlog top-to-bottom
   - Rationale: imported plans need predictable execution order

## Execution Phases

### Phase 1: Planning docs and acceptance criteria
Deliverables:
1. Add this plan file and matching `status.md`.
2. Freeze parsing and UX decisions for the first pass.

Exit criteria:
1. Decisions above are reflected in implementation and tests.

### Phase 2: Runtime workspace markdown read support
Changes:
1. Add shared request/response contracts for reading a workspace file.
2. Add request validation.
3. Add a safe workspace helper that validates path, extension, workspace containment, and file size.
4. Expose a `workspace.readFile` TRPC query and cover it with tests.

Exit criteria:
1. Web UI can read a selected markdown file through the runtime using workspace scoping.
2. Invalid paths, unsupported extensions, and missing files fail safely.

### Phase 3: Prompt parsing and ordered batch creation
Changes:
1. Move plain list parsing into `web-ui/src/utils/task-prompt.ts`.
2. Add markdown import parsing with tests.
3. Update batch creation in `useTaskEditor` so backlog order matches source order.

Exit criteria:
1. Imported tasks are editable before creation.
2. Creating multiple tasks preserves document order visually.

### Phase 4: Create-dialog import UX
Changes:
1. Add markdown search/load controls to the main create dialog.
2. Let users choose a markdown file, parse prompts, and review/edit them in multi-task mode.
3. Show clear errors for empty parses and read failures.

Exit criteria:
1. A user can import tasks from a workspace PRD/strategy file without leaving the dialog.
2. Existing single-task and prompt-splitting flows continue to work.

### Phase 5: Validation and PR polish
Changes:
1. Run targeted runtime and web tests.
2. Confirm no unnecessary architectural spread beyond the existing task-create flow.

Exit criteria:
1. Relevant tests pass.
2. The diff remains tight and upstream-friendly.

## Risks and Mitigations
1. Parser under-extracts useful tasks
   - Mitigation: support explicit checklist items anywhere and common execution headings.
2. Parser over-extracts non-task bullets
   - Mitigation: ignore checked items, nested bullets, code fences, and non-execution sections.
3. Search results become stale between search and read
   - Mitigation: revalidate the selected path in the server-side read helper.
4. Batch order change surprises existing multi-create users
   - Mitigation: keep the change small, test it directly, and call it out in the summary/PR notes.

## Validation Checklist
1. Runtime/API
   - `test/runtime/api-validation.test.ts`
   - `test/runtime/trpc/workspace-api.test.ts`
   - helper test for workspace markdown reads
2. Web UI
   - `web-ui/src/utils/task-prompt.test.ts`
   - `web-ui/src/hooks/use-task-editor.test.tsx`
   - targeted create-dialog coverage if needed
3. Manual flow
   - search and import a markdown plan file
   - verify imported prompts include `@path`
   - create tasks and confirm backlog order matches document order
   - confirm back-to-single behaves correctly for prompt split vs markdown import

## Rollback Strategy
1. Keep the runtime file-read path isolated behind `workspace.readFile`.
2. Keep markdown parsing isolated in `task-prompt.ts`.
3. If the feature needs to be reverted, remove the dialog import UI and the additive runtime route without affecting saved board data.

## Progress Tracking Location
Use `.plan/04-prd-task-bootstrap/status.md` as the implementation tracker for this initiative.
