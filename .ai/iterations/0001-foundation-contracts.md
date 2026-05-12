# Iteration 0001: Foundation Contracts

## Trigger

The user authorized implementation to begin using the controller-led workflow.

## Current Capability

The project now has a Node/TypeScript package skeleton, durable AI workflow
artifacts, route configuration, a formal spec, decisions log, and shared task
types.

## Goals

- Stabilize the contract before executor agents begin coding.
- Mark implementation tasks ready only after artifact layout, model routing,
  and todo schema are defined.

## Decisions

- Use TypeScript for the MVP implementation.
- Use Node's built-in test runner after TypeScript compilation.
- Use YAML for human-editable route and todo configuration.
- Keep TUI, state, and router write scopes separate for parallel execution.

## Todo Changes

Added:

- None

Completed:

- T-001
- T-002
- T-003

Blocked:

- None

Deferred:

- None

Ready:

- T-004
- T-005
- T-006

## Dispatch Plan

Dispatch three executor agents in parallel:

- T-004: initial TUI shell
- T-005: state manager
- T-006: model router

These tasks have disjoint write scopes.

## Execution Summary

Main thread created:

- `package.json`
- `tsconfig.json`
- `.ai/spec.md`
- `.ai/decisions.md`
- `.ai/routes.yaml`
- `src/shared/types.ts`

Dependencies were installed with `npm install`.

## Review Summary

No independent review has run yet.

## Capability After Iteration

The project is ready for parallel executor implementation of the first MVP
components.

## Remaining Gaps

- No TUI shell exists.
- No state manager exists.
- No model router exists.
- No execution or review dispatch exists.

## Next Iteration Recommendation

Run T-004, T-005, and T-006 through executor agents, then dispatch a reviewer
against their combined result.
