# T-016 Result

## Changed Files

- `src/dispatch/index.ts`
- `src/execution/index.ts`
- `tests/dispatch/dispatch.test.ts`

## Summary

Implemented a reusable executor dispatch service that loads todo/spec state,
builds the executor handoff prompt, runs an external command through the
existing process runner, and persists todo, queue, history, and run artifacts.
The process runner now persists spawn errors as failed run results instead of
allowing missing executor commands to leave empty logs or running state.

## Verification

- `npm run typecheck`: passed
- `npm test`: passed, 59 tests

## Risks

- This bridge runs local commands only. Real agent/model invocation remains a
  future provider concern.
