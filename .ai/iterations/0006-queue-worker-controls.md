# Iteration 0006: Queue Worker Controls

## Trigger

The user asked to keep looping through planning, design, todo creation,
execution, and review. The previous iteration recommended queue worker controls
as the next useful capability.

## Current Capability

- TUI can list todo, queue, history, projects, and iteration notes.
- `next` syncs dispatchable ready tasks into `.ai/task-queue.yaml`.
- `run <task-id> --executor-command CMD --executor-arg ARG` executes a specific
  task through the external executor bridge.
- Successful executor runs preserve the review gate by moving tasks to
  `review` by default.

## Goals

- Add a queue worker command that can execute the next pending queue item.
- Keep queue state separate from executor command configuration.
- Support reusable executor command profiles without introducing model provider
  adapters.

## Decisions

- MiniMax planning was used and saved to `plans/latest-minimax-plan.md`.
- MiniMax review was attempted but hung for more than two minutes, so manual
  review took over.
- Queue worker behavior lives in `src/worker/index.ts` instead of the TUI layer.
- Executor profiles live in `.ai/executor-profiles.yaml`; queue items remain
  deterministic task state.
- `run-next` also accepts explicit `--executor-command` options for parity with
  `run <task-id>`.

## Todo Changes

Added and completed:

- T-019 Design queue worker control iteration
- T-020 Implement queue worker run-next service
- T-021 Wire CLI run-next command
- T-022 Review queue worker control iteration

Blocked:

- None

Deferred:

- Long-running queue daemon or watch mode.
- Built-in timeout controls for executor commands.
- Real model provider adapters.

## Dispatch Plan

Mostly sequential:

1. Design the queue worker scope.
2. Implement reusable worker service.
3. Wire CLI and TUI command registry.
4. Review state persistence, queue selection, profile handling, and tests.

## Execution Summary

Implemented:

- `src/worker/index.ts`
- worker service tests
- TUI command registry support for `run-next`
- CLI `run-next` command
- executor profile example
- README and spec updates

## Review Summary

Review approved after one manual follow-up fix:

- Absolute `--profiles` paths are now resolved correctly.

Review artifact:

- `.ai/runs/T-022/review.md`

## Capability After Iteration

The workbench can now run the next queued task automatically: it syncs ready
tasks into the queue, picks the highest-priority pending item, resolves an
executor command from a profile or CLI options, and records artifacts, queue
status, todo status, and history through the existing dispatch service.

## Remaining Gaps

- Add executor timeout controls.
- Add a `run-next --dry-run` preview.
- Add queue worker profile validation commands.
- Add real provider adapters after local queue execution feels solid.

## Next Iteration Recommendation

Build executor safety controls next: timeout configuration, dry-run preview, and
profile validation. Keep daemon/watch behavior separate until one-shot queue
execution has enough guardrails.
