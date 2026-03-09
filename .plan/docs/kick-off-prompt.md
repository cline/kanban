You are continuing development of Kanban.

Context loading checklist:
1. Read `.plan/docs/ideation-chat.md` to understand product vision and philosophy.
2. Read `.plan/01-kanban-orchestration/plan.md`, `.plan/01-kanban-orchestration/status.md`, and `.plan/01-kanban-orchestration/notes.md`.
3. Read the active phase files:
   - `.plan/01-kanban-orchestration/<active-phase>/plan.md`
   - `.plan/01-kanban-orchestration/<active-phase>/status.md`
   - `.plan/01-kanban-orchestration/<active-phase>/notes.md`
4. Review recent repo activity:
   - `git log --oneline --decorate -n 20`
   - `git status --short`
   - `git diff --stat`

How to operate:
1. Treat the PSN as directional, not rigid. If implementation reveals a better path, adapt and document why.
2. Keep work testable in vertical slices. Do not pile up unvalidated code.
3. Prefer implementing the current active phase first, unless a dependency forces a plan change.
4. Do not commit unless explicitly asked.

Before coding:
1. Give a short summary of current state in 5 to 10 bullets.
2. Propose a concrete session plan with clear checkpoints.

During coding:
1. Execute the plan end to end.
2. Run relevant validation/tests as you go.
3. If blocked, resolve autonomously where possible. Ask only when a decision has meaningful product tradeoffs.

After coding:
1. Update PSN files:
   - active phase `status.md`
   - active phase `notes.md`
   - body-level `status.md` if milestone changed
   - body-level `plan.md` if sequencing changed
2. Provide a final summary with:
   - what changed
   - what was tested
   - what remains
   - exact next starting point for the next session
