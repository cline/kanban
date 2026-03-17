# PRD Task Bootstrap Status

## Current State
1. Initiative: `04-prd-task-bootstrap`
2. Overall progress: implemented, pending full local verification
3. Last updated: 2026-03-16

## Decision Tracker
1. Import entry point (`TaskCreateDialog` only)
   - Status: decided
2. Supported file types (`.md`, `.markdown`, `.mdx`)
   - Status: decided
3. Imported prompt source references (`@path` suffix)
   - Status: decided
4. Importable markdown rules (unchecked checklists + execution-section lists)
   - Status: decided
5. Preserve batch order visually in backlog
   - Status: decided

## Phase Checklist

### Phase 1: Planning and acceptance criteria
- [x] Review existing task-create and workspace file search flows
- [x] Add initiative plan and status tracker
- [x] Freeze first-pass scope decisions

### Phase 2: Runtime workspace markdown read support
- [x] Add shared request/response contracts
- [x] Add validation helper
- [x] Add safe workspace markdown read helper
- [x] Add TRPC route and runtime tests

### Phase 3: Prompt parsing and ordered batch creation
- [x] Move plain list parsing into shared prompt utilities
- [x] Add markdown import parsing tests
- [x] Preserve input order in batch backlog creation

### Phase 4: Create-dialog import UX
- [x] Add markdown import search/load controls
- [x] Parse imported markdown into editable task prompts
- [x] Handle empty parse and read failures cleanly

### Phase 5: Validation and PR polish
- [ ] Run targeted tests (blocked locally: repo dependencies are not installed in this workspace)
- [x] Verify the diff stays tight and upstream-friendly

## Investigation Summary
1. The feature can reuse existing multi-create and create-and-start flows.
2. The main additive backend gap is safe workspace markdown file reading.
3. The main non-additive behavior change is fixing batch creation order to match input order visually.

## Open Risks
1. Some PRD markdown files may not contain importable actionable items.
2. Search index staleness can produce paths that no longer exist at read time.
3. UI complexity can grow if import UX spreads beyond the main create dialog.

## Resume Point
Install workspace dependencies, then run the targeted root and web-ui test/typecheck commands to finish Phase 5 verification.
