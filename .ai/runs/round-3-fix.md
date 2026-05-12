# Round 3 Fix

## Trigger

Round 3 review blocked T-007 and T-010.

## Findings Addressed

### T-007

Reviewer finding:

- Planning helpers existed, but the TUI/CLI `plan` command only selected a view
  and did not create or update spec/todo artifacts.

Fix:

- Extended `src/tui/cli.ts` so `ai-workbench plan --prompt TEXT
  --spec-output FILE --todo-output FILE` creates/updates `.ai/spec.md` and
  `.ai/workflow-todo.yaml`.
- The command saves full model outputs to `.ai/runs/planning/` and prints only
  compact summaries.
- Added TUI CLI coverage in `tests/tui/shell.test.ts`.

### T-010

Reviewer finding:

- `applyReviewOutcomeToTodo` could move non-`review` tasks directly to `done` or
  `fix_needed`, bypassing lifecycle validation.

Fix:

- `applyReviewOutcomeToTodo` now checks the current task status with
  `isValidTaskTransition` and throws `InvalidTaskTransitionError` for invalid
  transitions.
- Added regression coverage for a `draft -> done` bypass attempt.

## Verification

- `npm test`: passed, 30 tests.
- `npm run typecheck`: passed.
