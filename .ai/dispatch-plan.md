# Dispatch Plan

## Current State

The initial todo list is complete and stored in `.ai/workflow-todo.yaml`.

There are 14 tasks:

- T-001 to T-003: foundation design tasks
- T-004 to T-006: first parallel implementation round
- T-007, T-008, T-010: orchestration and handoff implementation
- T-009, T-011, T-012: run loop, iteration, and end-to-end validation
- T-013, T-014: durable iteration memory and TUI iteration dashboard

## Why Not Dispatch Executors Immediately

Executor agents should not start before the contract exists. The current ready
tasks are foundation tasks that define:

- artifact layout
- task lifecycle
- model routing schema
- todo schema
- validation rules

If executor agents start before those are stable, they will make incompatible
assumptions and create integration debt.

## Round 1: Main Thread Foundation

Owner: main thread

Tasks:

- T-001: Define durable artifact layout and task state machine
- T-002: Design model routing schema
- T-003: Specify todo item schema and validation rules

Expected outputs:

- `.ai/spec.md`
- `.ai/decisions.md`
- `.ai/routes.yaml`
- updated `.ai/workflow-todo.yaml`

Exit criteria:

- T-001, T-002, and T-003 are marked done.
- T-004, T-005, and T-006 are marked ready.
- Their write scopes do not overlap.

## Round 2: Parallel Executor Agents

Dispatch three executor agents in parallel:

### Executor A

Task: T-004, initial TUI shell

Write scope:

- `package.json`
- `src/tui/**`
- `tests/tui/**`

### Executor B

Task: T-005, state manager

Write scope:

- `src/state/**`
- `tests/state/**`

### Executor C

Task: T-006, model router

Write scope:

- `src/router/**`
- `tests/router/**`

These can run in parallel because the write scopes are separate.

## Round 2 Review

After all three executors report completion:

1. Dispatch one reviewer agent.
2. Reviewer reads `.ai/spec.md`, `.ai/workflow-todo.yaml`, executor result files, test output, and the full diff.
3. Reviewer writes `.ai/runs/round-2-review.md`.
4. Main thread decides:
   - mark done
   - create fix tasks
   - block and ask human

## Round 3: Handoff and Review Protocol

Dispatch after Round 2 passes review:

- T-007: planning commands
- T-008: executor dispatch protocol
- T-010: review dispatch protocol

T-007 depends on the TUI shell, state manager, and router. T-008 and T-010 can
be mostly parallel, but both depend on the state manager and router.

## Round 4: Integration Loop

Run mostly sequentially:

- T-009: run monitor and task status updates
- T-011: iteration loop command
- T-012: end-to-end MVP smoke flow

## Round 5: Iteration Memory

Dispatch after Round 4 passes review:

- T-013: iteration artifact management
- T-014: TUI iteration dashboard

T-013 depends on state management. T-014 depends on the TUI shell and iteration
artifact management.

## Main Flow Iteration

After each review:

1. Summarize what changed.
2. Summarize what passed.
3. Summarize what failed.
4. Update todo statuses.
5. Create new fix tasks if needed.
6. Ask the human only for decisions that require product or risk judgment.
7. Write `.ai/iterations/NNNN-short-title.md` before starting the next round.
