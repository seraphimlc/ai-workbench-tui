# T-017 Result

## Changed Files

- `src/tui/cli.ts`
- `tests/tui/shell.test.ts`
- `README.md`
- `.ai/spec.md`

## Summary

Extended `ai-workbench run <task-id>` so the existing prepare-only behavior is
preserved by default, while `--executor-command` and repeated `--executor-arg`
options execute a real external command through the dispatch service.

## Verification

- `npm run typecheck`: passed
- `npm test`: passed, 59 tests

## Risks

- Argument passing is intentionally simple for the MVP. Complex shell command
  strings should be wrapped in a script and passed as command plus args.
