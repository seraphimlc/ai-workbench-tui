# Iteration 0003: Round 3 Orchestration Protocols

## Trigger

Round 2 established TUI shell, state manager, and model router. The next
iteration implemented planning helpers, executor handoff, review handoff, and
iteration artifact management.

## Current Capability

The project now has:

- deterministic spec/todo planning helpers
- CLI `plan` command that writes spec/todo artifacts from model output files
- executor handoff prompt builder
- background executor process runner with redacted logs
- deterministic review request/outcome helpers
- lifecycle-safe review outcome application
- iteration artifact listing, creation, rendering, and latest lookup

## Goals

- Add the protocols needed for real main-thread orchestration.
- Keep long model output out of the TUI while preserving exact artifacts.
- Ensure review results cannot bypass task lifecycle rules.

## Decisions

- Real model calls are still out of scope for these modules; they operate on
  model output supplied by the caller.
- CLI `plan` accepts model output files, saves exact artifacts, and prints only
  compact summaries.
- Review outcome application must reject invalid state transitions instead of
  silently mutating todo state.

## Todo Changes

Added:

- None

Completed:

- T-007
- T-008
- T-010
- T-013

Blocked:

- Round 3 review initially blocked T-007 and T-010.

Fixed:

- T-007 now has CLI plan command integration.
- T-010 now validates lifecycle transitions before applying review outcomes.

Ready:

- T-009
- T-011
- T-014

Deferred:

- T-012 remains draft until T-009, T-011, and T-014 are complete.

## Dispatch Plan

Next viable work:

- T-009: run monitor and task status updates
- T-011: iteration loop command
- T-014: TUI iteration dashboard

T-009 and T-011 touch execution/state/commands. T-014 touches TUI. T-014 can run
in parallel with one of T-009 or T-011 if write scopes remain separate.

## Execution Summary

Executors completed:

- T-007: `src/commands/**`, `tests/commands/**`
- T-008: `src/execution/**`, `tests/execution/**`
- T-010: `src/review/**`, `tests/review/**`
- T-013: `src/iterations/**`, `tests/iterations/**`

Main thread fixed:

- TUI CLI `plan` command integration.
- Review lifecycle validation bypass.

## Review Summary

Initial Round 3 review blocked T-007 and T-010.

Re-review approved after fixes.

Evidence:

- `npm test`: passed, 30 tests.
- `npm run typecheck`: passed.
- Manual smokes confirmed the two prior blockers are fixed.

Review artifacts:

- `.ai/runs/round-3-review.md`
- `.ai/runs/round-3-fix.md`
- `.ai/runs/round-3-rereview.md`

## Capability After Iteration

The project can now preserve planning outputs, update spec/todo from supplied
model outputs, build executor handoffs, run background processes with redacted
logs, build review inputs, apply review outcomes safely, and manage iteration
notes.

## Remaining Gaps

- No run monitor yet updates task status from execution results.
- No iteration loop command yet converts review results into next-round todo
  changes.
- TUI does not show iteration dashboard data.
- End-to-end smoke flow is not implemented.

## Next Iteration Recommendation

Implement T-009, T-011, and T-014, then finish with T-012 end-to-end MVP smoke
flow and final review.
