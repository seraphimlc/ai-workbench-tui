# Iteration 0007: Executor Safety Controls

## Trigger

After queue worker controls landed, the remaining gap was safety around
one-shot executor runs: preview before execution, timeout protection, and
profile validation.

## Current Capability

- `run-next` can sync ready tasks into the queue and run the highest-priority
  pending task.
- Executor profiles can provide reusable command/argument presets.
- Successful executor runs preserve the review gate by moving tasks to
  `review` by default.

## Goals

- Add a dry-run preview before process execution.
- Add timeout handling so long-running executor commands cannot hang forever.
- Add profile validation so configuration errors are visible before dispatch.

## Decisions

- MiniMax planning was used and saved to `plans/latest-minimax-plan.md`.
- Timeout values are milliseconds and can come from `--timeout-ms` or profile
  `timeout_ms`.
- `timeout_ms: 0` is treated as no timeout.
- `run-next --validate-profiles` validates the profile file without requiring a
  queued task.

## Todo Changes

Added and completed:

- T-023 Design executor safety controls iteration
- T-024 Implement executor timeout and dry-run safety controls
- T-025 Wire CLI safety controls and profile validation
- T-026 Review executor safety controls iteration

Blocked:

- None

Deferred:

- Queue daemon/watch mode.
- Process-tree termination across grandchildren.
- Real model provider adapters.

## Dispatch Plan

Mostly sequential:

1. Extend execution and worker contracts.
2. Add CLI flags and tests.
3. Update project memory and review artifacts.

## Execution Summary

Implemented:

- executor process timeout metadata and termination
- timeout reason propagation into todo summaries
- worker dry-run preview without workflow state writes
- profile `timeout_ms`
- profile validation result reporting
- CLI `run-next --dry-run`
- CLI `run-next --timeout-ms`
- CLI `run-next --validate-profiles`

## Review Summary

Review approved with no findings.

Review artifact:

- `.ai/runs/T-026/review.md`

## Stop / Continue Decision

Decision: stop

Reason:

- Executor safety controls are complete and verified.
- The next useful action is consolidation and a commit boundary, not more feature expansion.
- Continuing feature work without a fresh objective lock would risk autonomous drift.

## Capability After Iteration

The workbench can safely preview and validate queued execution before running
it, and long-running executor commands are converted into blocked tasks with
persisted timeout evidence.

## Remaining Gaps

- Add process-tree cleanup for executors that spawn grandchildren.
- Add profile lint output with more precise source locations.
- Add a provider-adapter design only after deciding whether local queue worker
  ergonomics are good enough.

## Next Iteration Recommendation

Pause feature expansion and do a consolidation pass: inspect the accumulated
diff, reduce duplication between CLI run and run-next option parsing, and decide
whether the current local-only MVP is ready for a commit boundary before moving
to model provider adapters.
