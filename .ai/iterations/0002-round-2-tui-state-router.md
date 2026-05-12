# Iteration 0002: Round 2 TUI, State, Router

## Trigger

Foundation contracts were completed and T-004, T-005, and T-006 were ready for
parallel executor implementation.

## Current Capability

The project now has:

- a deterministic TUI shell renderer and CLI smoke entry
- a file-based state manager
- a configurable model router
- tests for TUI, state, and router

## Goals

- Validate that parallel executor agents can work against bounded write scopes.
- Establish the first usable MVP components.
- Run an independent reviewer after executor completion.

## Decisions

- Keep the TUI shell deterministic for now; interactive behavior can come after
  the state and dispatch protocols are stable.
- Keep the model router pure and testable; process/model invocation belongs in
  execution dispatch.
- Treat stale executor report caveats as notes when current integration tests
  and reviewer evidence pass.

## Todo Changes

Added:

- None

Completed:

- T-004
- T-005
- T-006

Blocked:

- None

Deferred:

- None

Ready:

- T-007
- T-008
- T-010
- T-013

## Dispatch Plan

Next viable parallel set:

- T-008: executor dispatch protocol
- T-010: review dispatch protocol
- T-013: iteration artifact management

T-007 is also ready, but it depends on the TUI, state manager, and router
working together. It can run in parallel if its write scope stays within
`src/commands/plan/**`, `src/commands/spec/**`, and `tests/commands/**`.

## Execution Summary

Executors completed:

- T-004: `src/tui/**`, `tests/tui/**`
- T-005: `src/state/**`, `tests/state/**`
- T-006: `src/router/**`, `tests/router/**`

Main thread integrated:

- synchronized `package-lock.json`
- fixed the `dev` script path
- ran full tests

## Review Summary

Independent reviewer approved Round 2.

Findings:

- Blocking/high: none
- Medium: none
- Low/notes: stale executor-report caveats only

Evidence:

- `npm test`: passed, 13/13
- `npm run typecheck`: passed
- CLI smoke checks passed

Review artifact:

- `.ai/runs/round-2-review.md`

## Capability After Iteration

The project can render a four-pane TUI shell, parse TUI commands, persist
workflow artifacts, validate task transitions, detect write-scope conflicts, and
resolve model routes with overrides/escalations.

## Remaining Gaps

- No actual executor process dispatch exists yet.
- No review dispatch protocol exists yet.
- No planning/spec command exists yet.
- No iteration artifact manager exists yet.
- The TUI displays summaries but does not yet orchestrate real actions.

## Next Iteration Recommendation

Dispatch T-008, T-010, and T-013 as the next parallel implementation group. If
capacity allows, dispatch T-007 as well because its write scope is separate.
