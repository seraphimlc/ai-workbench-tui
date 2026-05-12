# AI Workbench TUI Spec

## Goal

Build a TUI-controlled AI workbench where the main conversation focuses on
discussion, planning, decisions, and todo management, while executor agents
perform bounded coding, testing, review, and fixes against structured task
specifications.

## Core Principle

The system separates two planes:

- Human interaction plane: discussion, planning, spec writing, todo management,
  status, review summary, and iteration design.
- Code execution plane: bounded implementation tasks, tests, logs, review, and
  fixes.

The main thread owns direction and state. Executor agents own implementation.
Reviewer agents own independent quality checks. A deterministic state manager
owns persistence and valid transitions.

## Artifact Layout

```text
.ai/
  spec.md
  decisions.md
  routes.yaml
  workflow-todo.yaml
  execution-protocol.md
  dispatch-plan.md
  iterations/
    README.md
    template.md
    NNNN-short-title.md
  runs/
    <task-id>/
      handoff.md
      stdout.log
      stderr.log
      result.md
      review.md
```

## Task Lifecycle

Allowed statuses:

```text
idea -> draft -> ready -> running -> review -> done
idea -> draft -> blocked
ready -> blocked
running -> blocked
review -> fix_needed -> ready
review -> done
```

Only the main thread may mark a task `ready`, `done`, `fix_needed`, or
`blocked` after reviewing evidence. Executors may write run artifacts but must
not directly edit `.ai/workflow-todo.yaml` unless assigned a state-management
task.

## Todo Contract

Every dispatchable todo must include:

- `id`
- `title`
- `type`
- `status`
- `agent`
- `dependencies`
- `write_scope`
- `acceptance`
- `output`

A task may not be dispatched unless:

- status is `ready`
- dependencies are `done`
- acceptance criteria are present
- write scope is bounded
- no running task has overlapping write scope

## Model Routing

Task routing is configurable. Agent roles and model choices are separate:

```text
task type -> agent role -> model -> mode -> fallback
```

The default route table lives at `.ai/routes.yaml`.

## TUI MVP

The first TUI should show:

- discussion/status pane
- spec/todo pane
- run/review pane
- log pane

It should support command-style actions:

- `status`
- `plan`
- `run <task-id>`
- `review <task-id>`
- `iterations`
- `quit`

## Iteration Rule

After every execution/review cycle, the main thread writes an iteration note in
`.ai/iterations/`. That note becomes required context for the next planning
cycle.
