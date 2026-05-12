# Final Review: AI Workbench TUI MVP

Status: blocked

Reviewer: final independent Reviewer Agent
Date: 2026-05-12

## Summary

The implementation is close to the requested MVP and the automated suite is
green, but I do not approve it as final because two todo mutation paths still
bypass the deterministic state-manager contract. The most important issue is in
the TUI planning command path: model-supplied todo YAML can overwrite existing
task statuses, create conflicting ready tasks, and create dispatchable-looking
ready tasks without acceptance criteria, all without using transition or
write-scope validation.

No task is currently marked `fix_needed` in `.ai/workflow-todo.yaml`, but T-007
should return to `fix_needed` or receive a blocking fix task before T-012 is
marked done. T-011 should also receive a follow-up fix unless the next
iteration folds both state-mutation fixes into one task. T-012 should remain in
`review` while this final review is blocked.

## Findings

### High: TUI planning todo merge can bypass lifecycle and dispatch safety

`generateOrUpdateTodoFromDiscussion` loads the existing todo, parses model YAML,
merges tasks, and writes the result directly with `state.saveTodo`
(`src/commands/plan/index.ts:47-56`). For existing tasks, `mergeTasks` replaces
the entire task object with the incoming one (`src/commands/plan/index.ts:141-150`).
The parser validates that status is one of the allowed strings, but it does not
validate state transitions, dependencies, non-empty acceptance criteria, or
ready/running write-scope conflicts (`src/commands/plan/index.ts:108-122`).

This violates the spec requirement that the deterministic state manager owns
valid transitions and prevents conflicting parallel write scopes. It also makes
the accepted CLI `plan` command capable of reopening or otherwise mutating
workflow state from model output alone.

Confirmed by smoke probes after build:

- Existing `done` task overwritten by plan output with `status: ready` saved as
  `ready`.
- Existing `ready` task with `write_scope: ["src/**"]` plus new ready task with
  `write_scope: ["src/foo.ts"]` saved successfully, even though
  `StateManager.validateReadyRunningWriteScopes` would reject that conflict.
- New ready task with `acceptance: []` saved successfully.

Missing tests:

- Existing task update through `generateOrUpdateTodoFromDiscussion` must reject
  invalid lifecycle transitions.
- Plan-generated ready/running todo state must be checked for write-scope
  conflicts.
- Ready tasks should require meaningful acceptance criteria and bounded
  write_scope before being saved as dispatchable.

### Medium: Iteration fix-task upsert can reset existing task state

`applyTodoChange` validates lifecycle transitions for `update_task`, but the
`upsert_task` path replaces an existing task wholesale without transition
validation (`src/commands/iterate/index.ts:222-260`). If a deterministic
`T-xxx-FIX-001` task already exists and is `running`, `review`, or `done`, a
rerun or edited proposal can silently replace it with the generated `draft`
version from `buildFixTask` (`src/commands/iterate/index.ts:263-284`).

Confirmed by smoke probe:

- Existing `T-1-FIX-001` with `status: done` was replaced by an accepted
  upsert proposal with `status: draft`.

Missing tests:

- Upserting an existing fix task should preserve current status unless an
  explicit valid transition is requested.
- Existing fix-task upsert should reject invalid status regressions.

## Acceptance Notes

- T-004, T-005, T-006, T-008, T-009, T-010, T-013, and T-014 are acceptable
  against their stated MVP criteria based on current tests and manual review.
- T-007 remains incomplete against the broader state contract because its plan
  command can write invalid todo state.
- T-011 is functionally present but has an integration safety gap in existing
  fix-task updates.
- T-012 should not be marked done until the final review blockers are fixed and
  rereviewed.

## Commands Run

```text
npm test
```

Result: passed. Build succeeded and Node test runner reported 42 tests, 42
passing, 0 failing.

```text
npm run typecheck
```

Result: passed.

```text
node dist/src/tui/cli.js --render-once
node dist/src/tui/cli.js iterations
node dist/src/tui/cli.js status
```

Result: all exited 0 and rendered the TUI shell / iteration output.

```text
node --input-type=module ... generateOrUpdateTodoFromDiscussion invalid overwrite probe
```

Result: reproduced `done -> ready` overwrite through the planning command path.

```text
node --input-type=module ... generateOrUpdateTodoFromDiscussion conflict probe
```

Result: reproduced conflicting ready tasks and an empty-acceptance ready task
being saved.

```text
node --input-type=module ... applyIterationProposalDecision upsert probe
```

Result: reproduced existing `done` fix task being overwritten to `draft`.

```text
codex-minimax review --stdout "Final review AI Workbench TUI MVP..."
```

Result: returned a generic checklist because this workspace is not a git
repository. It was useful only as an advisory reminder around lifecycle and
merge risks; concrete findings above are from direct source review and smoke
probes.

```text
rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!package-lock.json' --glob '!.env.minimax' '(API[_-]?KEY|TOKEN|SECRET|PASSWORD|PRIVATE[_-]?KEY|MINIMAX_[A-Z_]+\s*=|sk-[A-Za-z0-9])' .
```

Result: found placeholders/test strings and scripts that reference environment
variable names, but no real committed API key was identified.

## Next Iteration Recommendations

1. Add a state-manager-level todo update API that validates status transitions,
   ready/running write-scope conflicts, and dispatchable ready-task fields.
2. Route `generateOrUpdateTodoFromDiscussion` through that API instead of
   replacing existing tasks directly.
3. Change iteration fix-task upsert so existing tasks are patched
   conservatively and invalid status regressions are rejected.
4. Add regression tests for plan-driven invalid transitions, plan-driven
   ready/running conflicts, empty ready-task acceptance, and existing fix-task
   upsert status preservation.
5. Rerun `npm test`, `npm run typecheck`, CLI smokes, and a focused final
   rereview before marking T-012 done.
