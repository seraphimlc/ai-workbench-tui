# Iteration 0008: Minimum Productization

## Trigger

The user asked whether the workbench could be given to other people who want to
use their own reasoning and execution models. The answer was that the core
workflow existed, but install, initialization, diagnostics, examples, and
adapter documentation were not yet sufficient.

## Current Capability

- The workbench can plan from model output files.
- `run-next` can execute external executor profiles with dry-run, timeout, and
  validation controls.
- `align` can show the current objective lock and stop/continue recommendation.

## Goals

- Let a developer initialize a new project with starter `.ai` files.
- Let a developer diagnose missing or invalid local setup.
- Provide one minimal executor example.
- Explain how to use custom reasoning and execution models.

## Decisions

- Keep this as a local-repository workflow, not npm publishing.
- Keep provider adapters external and command-based.
- Make `init` non-destructive by default; use `--force` for overwrites.

## Todo Changes

Added and completed:

- T-027 Design minimum productization pass
- T-028 Implement init and doctor commands
- T-029 Add example executor and model adapter documentation
- T-030 Review minimum productization pass

Blocked:

- None

Deferred:

- npm publishing
- provider marketplace
- interactive setup wizard

## Dispatch Plan

Sequential:

1. Add setup helpers and tests.
2. Wire CLI commands.
3. Add example executor and docs.
4. Review and verify.

## Execution Summary

Implemented:

- `src/setup/index.ts`
- `init` CLI command
- `doctor` CLI command
- setup tests
- CLI tests for init/doctor
- `examples/executors/echo-executor.js`
- `docs/getting-started.md`
- `docs/model-adapters.md`
- README quickstart links

## Review Summary

Review approved with no findings.

Review artifact:

- `.ai/runs/T-030/review.md`

## Stop / Continue Decision

Decision: stop

Reason:

- Minimum productization is now present.
- The next useful step is a clean full verification and commit boundary.
- Publishing and provider adapters should wait for a fresh objective lock.

## Capability After Iteration

A developer can initialize a workbench project, run diagnostics, inspect a
starter executor profile, and read how to connect their own reasoning and
execution models.

## Remaining Gaps

- `npm link` and clean clone verification should be documented with real
  release steps.
- Provider-specific examples can be added later.
- Error messages can be polished after external feedback.

## Next Iteration Recommendation

Do not add features next. Consolidate the accumulated diff, run a clean clone or
fresh-directory smoke test, and create a commit boundary.
