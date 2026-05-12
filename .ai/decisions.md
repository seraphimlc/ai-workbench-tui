# Decisions

## D-001: Keep Agent Roles Small

Use three LLM roles: orchestrator, executor, and reviewer. State management is a
deterministic program, not an LLM agent.

## D-002: Separate Roles From Models

Task type decides route. Agent role decides responsibility. Model choice remains
configurable by global, project, and single-run overrides.

## D-003: State Is File-Based First

The MVP persists state in `.ai` files instead of a database. This keeps the
system inspectable and easy to recover.

## D-004: Executors Do Not Own Product Direction

Executors receive bounded handoffs and acceptance criteria. They should not
expand scope or reinterpret product goals.

## D-005: Review Must Inspect Evidence

Reviewer input must include acceptance criteria, diff, test output, and executor
report. Executor self-report alone is not enough.
