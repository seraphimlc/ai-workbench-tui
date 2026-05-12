# Iteration 0004: MVP Smoke And Final Review

## Trigger

T-009, T-011, T-012, and T-014 completed the final MVP loop: run monitoring,
iteration loop, TUI iteration dashboard, and end-to-end smoke coverage.

## Current Capability

The project can now:

- render a TUI shell with workflow panes and iteration dashboard
- list and draft iteration notes
- update spec and todo artifacts from supplied model output files
- build bounded executor handoff prompts
- run background executor processes and capture redacted artifacts
- monitor run results and update task statuses
- build reviewer requests and save review outcomes
- convert review findings into next-iteration todo changes
- run an end-to-end smoke test through the MVP flow

## Goals

- Complete the MVP implementation loop.
- Verify the full workflow with automated tests.
- Run independent final review and address blockers.

## Decisions

- Keep real model invocation outside the TUI core for this MVP.
- Preserve model outputs as artifacts and show compact summaries in the TUI.
- Treat lifecycle validation as a state contract and protect it in all todo
  mutation paths.

## Todo Changes

Added:

- None

Completed:

- T-009
- T-011
- T-012
- T-014

Blocked:

- Final review initially blocked the MVP on state-contract issues.

Fixed:

- Planning todo merge now validates lifecycle transitions, dispatchable ready
  fields, and ready/running write-scope conflicts.
- Iteration fix-task upsert now preserves existing status when incoming status
  would be an invalid lifecycle regression.

Deferred:

- Direct model invocation from the TUI.
- Real external CLI agent integration beyond deterministic process runner.

## Dispatch Plan

No implementation tasks remain in the current MVP todo list.

## Execution Summary

Completed:

- run monitor helpers
- iteration loop helpers
- TUI iteration dashboard
- end-to-end MVP smoke test
- README update
- final review fixes

## Review Summary

Final review initially blocked.

Final re-review approved after fixes.

Evidence:

- `npm test`: passed, 46 tests.
- `npm run typecheck`: passed.

Review artifacts:

- `.ai/runs/final-review.md`
- `.ai/runs/final-fix.md`
- `.ai/runs/final-rereview.md`

## Capability After Iteration

The MVP validates the proposed controller-led workflow end to end using
deterministic local modules and artifacts.

## Remaining Gaps

- Add real model provider adapters.
- Add real external executor CLI integration.
- Add project/global configuration loading for routes in the TUI.
- Add richer interactive TUI controls.
- Add git-aware diff collection for reviewer requests.

## Next Iteration Recommendation

Start the next cycle by designing provider adapters and a real executor CLI
bridge, while keeping the current deterministic core as the tested contract.
