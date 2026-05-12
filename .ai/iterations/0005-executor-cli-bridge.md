# Iteration 0005: Executor CLI Bridge

## Trigger

The user asked to keep rolling through the loop: design todo list, execute todo,
review, then iterate again. They also confirmed the intended routing: planning
and design should use MiniMax when available, while code execution remains under
GPT/Codex.

## Current Capability

- TUI can list todo, queue, history, projects, and iteration notes.
- `next` can sync dispatchable ready tasks into `.ai/task-queue.yaml`.
- `run <task-id>` without executor options records prepare-only handoff intent.
- `run <task-id> --executor-command CMD --executor-arg ARG` now executes a real
  external command, sends the executor handoff on stdin, captures artifacts, and
  updates todo, queue, and run history.

## Goals

- Add a real local executor CLI bridge without introducing model providers.
- Preserve the main-thread review gate by moving successful runs to `review`.
- Keep queue and history persistence deterministic and testable.

## Decisions

- MiniMax planning was attempted for this iteration but hung twice. GPT/Codex
  took over planning to avoid blocking the loop.
- Executor command invocation uses explicit command plus repeated
  `--executor-arg` options instead of shell string parsing.
- The dispatch service lives outside the TUI layer so future TUI, queue worker,
  or Web UI surfaces can reuse it.

## Todo Changes

Added and completed:

- T-015 Design executor CLI bridge iteration
- T-016 Implement reusable executor dispatch service
- T-017 Wire CLI run command to executor bridge
- T-018 Review executor CLI bridge iteration

## Dispatch Plan

Sequential:

1. Design the bridge scope.
2. Implement reusable dispatch service.
3. Wire CLI `run` command to dispatch service.
4. Review state transitions, persistence, and test coverage.

## Execution Summary

Implemented:

- `src/dispatch/index.ts`
- dispatch service tests
- executable CLI run path
- CLI executable path test
- README and spec updates

## Review Summary

Review approved with no blocking findings.

Review artifact:

- `.ai/runs/T-018/review.md`

## Capability After Iteration

The workbench can now launch an external local executor command from a todo
task and capture the result into the same artifact/state model used by the rest
of the system.

## Remaining Gaps

- Add a queue worker for `run-next` style automatic dispatch.
- Add configurable executor command profiles.
- Add real model provider adapters.
- Improve MiniMax timeout/fallback behavior so planning failures are faster and
  more visible.

## Next Iteration Recommendation

Build queue worker controls next: `run-next`, queue item status transitions,
and command profile configuration. Keep provider adapters separate until the
local execution bridge is comfortable.
