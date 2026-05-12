# Execution Protocol

This project follows a controller-led, subagent-executed workflow.

## Roles

### Main Thread

The main thread is the controller. It owns discussion, planning, todo state,
human decisions, task routing, and iteration. It should not casually do large
implementation work itself.

### Executor Agents

Executor agents perform bounded implementation work. Each executor receives one
ready todo or one explicit group of non-conflicting todos. Executors must not
reinterpret product direction or expand scope.

### Reviewer Agent

The reviewer agent performs independent review after executor work. It reviews
diffs and evidence against the spec and acceptance criteria. It should not rely
only on executor self-report.

### State Manager

The state manager should be deterministic code, not an LLM. It persists
artifacts, validates transitions, and prevents conflicting parallel writes.

## Loop

1. Main thread discusses with the human.
2. Main thread updates `.ai/spec.md`, `.ai/decisions.md`, and `.ai/workflow-todo.yaml`.
3. Main thread marks clear tasks as `ready`.
4. Main thread dispatches executor agents for ready, non-conflicting tasks.
5. Each executor writes `.ai/runs/<task-id>/result.md`.
6. Reviewer agent reviews executor output and writes `.ai/runs/<task-id>/review.md`.
7. Main thread reads review results.
8. Main thread marks task `done`, `fix_needed`, or `blocked`.
9. Main thread updates the todo list and starts the next iteration.

## Continuous Iteration Loop

The workflow is not complete after one execution/review cycle. The main thread
must continuously run:

```text
Observe current state
-> Discuss with human
-> Plan next capability
-> Update spec and todo
-> Dispatch ready tasks
-> Collect execution reports
-> Review evidence
-> Integrate results
-> Write iteration note
-> Start next design cycle
```

Each cycle produces an iteration artifact in `.ai/iterations/`.

The iteration artifact is the bridge from one round to the next. It must
summarize:

- current capability
- goals for the round
- decisions made
- todo changes
- dispatch plan
- execution summary
- review summary
- capability after iteration
- remaining gaps
- next iteration recommendation

The main thread should treat the latest iteration note as required context
before designing new work.

## Dispatch Rules

- Do not dispatch a task unless it has acceptance criteria.
- Do not dispatch a task unless it has bounded `write_scope`.
- Do not dispatch two parallel tasks with overlapping `write_scope`.
- Do not let executor agents edit `.ai/workflow-todo.yaml` directly unless assigned a state-management task.
- Review agents must receive acceptance criteria, diff, test output, and executor report.
- High-risk work should require GPT-level review or human approval.

## First Execution Round

Round 1 should be done by the main thread:

- T-001: Define durable artifact layout and task state machine.
- T-002: Design model routing schema.
- T-003: Specify todo item schema and validation rules.

Only after these are stable should implementation agents start.

Round 2 can be parallelized:

- T-004: Initial TUI shell.
- T-005: State manager.
- T-006: Model router.

Round 3 can be parallelized after dependency checks:

- T-007: Main-thread planning commands.
- T-008: Executor dispatch protocol.
- T-010: Review dispatch protocol.

Round 4 is mostly sequential:

- T-009: Run monitor and task status updates.
- T-011: Iteration loop command.
- T-012: End-to-end MVP smoke flow.

## Main Thread Iteration Rule

After every review phase, the main thread must produce a short iteration note:

- what changed
- what passed
- what failed
- what was deferred
- which todos changed status
- what should happen next

Save the note as:

```text
.ai/iterations/NNNN-short-title.md
```

Use `.ai/iterations/template.md` as the template. Do not rely only on chat
history for iteration memory.
