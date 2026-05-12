# Final Review Fix

## Trigger

Final review blocked the MVP on two state-contract issues.

## Fixes

### Planning todo merge validation

Problem:

- `generateOrUpdateTodoFromDiscussion` could overwrite task statuses from model
  YAML, create conflicting ready tasks, and save ready tasks without dispatchable
  fields.

Fix:

- Added validation before saving merged todo state:
  - existing task status changes must follow valid lifecycle transitions
  - ready/running tasks must have acceptance criteria
  - ready/running tasks must have bounded write scope
  - ready/running write scopes must not conflict
- Added regression tests for invalid transition, empty ready acceptance, and
  ready write-scope conflicts.

### Iteration fix-task upsert status preservation

Problem:

- Existing fix tasks could be overwritten back to `draft`.

Fix:

- Existing upserted tasks now preserve current status when incoming status would
  be an invalid lifecycle regression.
- Added regression coverage for existing done fix tasks.

## Verification

- `npm test`: passed, 46 tests.
- `npm run typecheck`: passed.
