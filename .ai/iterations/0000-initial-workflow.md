# Iteration 0000: Initial Workflow Design

## Trigger

The user wants to validate a controller-led workflow: the main conversation
focuses on discussion, planning, todo management, and iteration, while subagents
execute bounded implementation tasks and an independent reviewer checks the
result.

## Current Capability

The workspace currently has:

- Global `codex-minimax` helper scripts.
- A draft `.ai/workflow-todo.yaml`.
- A draft `.ai/execution-protocol.md`.
- A draft `.ai/dispatch-plan.md`.

No TUI implementation exists yet.

## Goals

- Define the persistent iteration loop.
- Make each round produce a durable note.
- Ensure the main thread can continue designing from previous results instead
  of relying only on chat history.

## Decisions

- Main thread owns iteration and product/engineering direction.
- Executor agents own bounded coding tasks.
- Reviewer agent owns independent quality review.
- State manager should be deterministic code, not an LLM role.
- Every iteration should record capability, gaps, decisions, todo changes,
  execution summary, review summary, and next recommendation.

## Todo Changes

Added:

- T-013: Implement iteration artifact management.
- T-014: Add TUI iteration dashboard.

Completed:

- None

Blocked:

- None

Deferred:

- Implementation remains deferred until foundation tasks are stable.

## Dispatch Plan

Do not dispatch executors yet. First complete foundation design tasks T-001,
T-002, and T-003.

## Execution Summary

No executor agents have run.

## Review Summary

No reviewer agent has run.

## Capability After Iteration

The project now has a durable iteration template and an initial iteration note.

## Remaining Gaps

- Foundation spec is not yet written.
- Todo schema is not yet formally validated.
- No TUI exists.
- No executor or reviewer protocol has been implemented.

## Next Iteration Recommendation

Complete T-001, T-002, and T-003 in the main thread, then mark T-004, T-005,
and T-006 ready for executor dispatch.
