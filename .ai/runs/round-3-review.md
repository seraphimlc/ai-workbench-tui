# Round 3 Review

Status: blocked

Reviewed tasks: T-007, T-008, T-010, T-013.

## Findings

### High: T-007 does not provide the accepted TUI planning command behavior

Acceptance criteria for T-007 require that a TUI command can create or update the
spec from a discussion prompt and generate or update the todo list
(`.ai/workflow-todo.yaml:207-210`). The implementation adds deterministic helper
functions in `src/commands/spec/index.ts` and `src/commands/plan/index.ts`, but
the actual TUI command surface still exposes `plan` only as a planning-context
view (`src/tui/index.ts:39-43`, `src/tui/index.ts:76-78`). Running
`npm run dev -- plan "draft spec"` confirms it only prints
`plan: planning context view selected`; it does not accept a prompt, invoke the
new helpers, create/update `.ai/spec.md`, create/update `.ai/workflow-todo.yaml`,
or surface the artifact summary.

This leaves the first two T-007 acceptance criteria unmet. The executor report
notes that live TUI wiring was skipped because T-007's write scope excluded
`src/tui/**`, but the acceptance criteria still explicitly say "TUI command".
Either the implementation needs a scoped integration task before T-007 is marked
done, or the acceptance criteria need to be narrowed by the main thread.

### High: T-010 can bypass the task lifecycle and state manager

The spec says the deterministic state manager owns persistence and valid
transitions (`.ai/spec.md:19-21`) and restricts status transitions to
`review -> done` or `review -> fix_needed` for review outcomes
(`.ai/spec.md:46-57`). `applyReviewOutcomeToTodo` directly maps the matching
task to `done` or `fix_needed` without checking the current status and without
using `StateManager.transitionTask` (`src/review/index.ts:102-113`).

I verified the behavior with a one-off Node command after build: applying an
approved review outcome to a `draft` task returns status `done`. That transition
is invalid under the lifecycle and bypasses the state manager's transition
guard. Current tests only cover tasks already in `review` status
(`tests/review/review.test.ts:66-104`), so this integration violation is not
covered. This should block marking T-010 done until review status updates are
validated through the state manager or reject non-review tasks.

## Acceptance Review

### T-007: Implement main-thread planning commands

- TUI command can create or update spec from a discussion prompt: not met. The
  helper can update spec, but no TUI command reaches it.
- TUI command can generate or update todo list: not met. The helper can update
  todo YAML, but no TUI command reaches it.
- Long model output is saved to artifacts and summarized in TUI: partially met.
  The helper saves exact artifacts and returns summaries, but those summaries are
  not surfaced through the TUI command path.
- Tests cover artifact creation and no-loss persistence: met for helper-level
  behavior.

Task disposition: fix_needed.

### T-008: Implement executor dispatch protocol

- Can build a bounded handoff prompt from spec, todo item, scope, and acceptance
  criteria: met.
- Can start a background CLI process for an executor: met.
- Captures stdout, stderr, exit code, timestamps, and artifact paths: met.
- Does not print secrets into logs: met for captured stdout, stderr, and handoff
  artifacts under the covered environment-like formats.

Task disposition: acceptable. Note: the run metadata artifact is named
`result.json`, while the project artifact layout centers executor reports on
`result.md`; this is not blocking for T-008's stated criteria but should be
kept in mind for later integration.

### T-010: Implement review dispatch protocol

- Reviewer input includes diff, acceptance criteria, test output, and execution
  report: met.
- Reviewer output is saved to `.ai/runs/<task-id>/review.md`: met.
- Review findings can update todo status to done or fix_needed: partially met,
  but unsafe because it bypasses valid transition checks.
- Tests cover clean review and review with actionable findings: met for the
  happy paths, missing invalid-status/state-manager integration coverage.

Task disposition: fix_needed.

### T-013: Implement iteration artifact management

- Can create the next numbered iteration note from the template: met.
- Can list existing iterations in order: met.
- Can read the latest iteration as required context for planning: met.
- Tests cover numbering, template rendering, and latest-iteration lookup: met.

Task disposition: acceptable.

## Commands Run

- `pwd && rg --files .ai src tests package.json tsconfig.json`
  - Passed; listed expected evidence and source/test files.
- `sed -n ...` / `nl -ba ...` over the requested evidence, implementation, and
  test files.
  - Passed; used for code and acceptance review.
- `git status --short`
  - Failed with `fatal: not a git repository`; reviewed filesystem contents
    directly instead of a git diff.
- `npm test`
  - Passed: 28 tests, 0 failures.
- `npm run typecheck`
  - Passed.
- `node --input-type=module - <<'NODE' ... applyReviewOutcomeToTodo ...`
  - Returned `done` for a task that started in `draft`, confirming the invalid
    transition bypass.
- `npm run dev -- plan "draft spec"`
  - Passed with exit code 0, but only selected the planning-context view and did
    not create/update planning artifacts.

I did not run `codex-minimax review` for this reviewer pass because the user's
write scope allows only `.ai/runs/round-3-review.md`, while the MiniMax review
workflow writes additional review artifacts outside that scope.

## Overall Recommendation

Do not mark Round 3 fully done yet. T-008 and T-013 are acceptable, but T-007
and T-010 should remain in or return to `fix_needed` until their blockers are
addressed.
