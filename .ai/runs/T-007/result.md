# T-007 Result

## Changed Files

- `src/commands/spec/artifacts.ts`
- `src/commands/spec/index.ts`
- `src/commands/plan/index.ts`
- `tests/commands/planning-commands.test.ts`
- `.ai/runs/T-007/result.md`

## Implementation

- Added deterministic spec command helper:
  - accepts a discussion prompt and model output
  - creates `.ai/spec.md` when missing
  - appends updates without dropping existing spec content
  - saves exact model output to `.ai/runs/<task-id>/<artifact>`
  - returns compact summary lines for TUI display
- Added deterministic todo command helper:
  - accepts a discussion prompt and YAML model output
  - creates `.ai/workflow-todo.yaml` when missing
  - parses `tasks` from YAML or fenced YAML
  - merges tasks by `id`, preserving unrelated existing tasks
  - saves exact model output to `.ai/runs/<task-id>/<artifact>`
  - returns compact summary lines with added/updated/preserved counts
- Added command tests for artifact creation, long-output summary behavior, and no-loss persistence.

## Tests Run

- `npm test -- --test-name-pattern "spec|todo|project files"`: passed
- `npm test`: passed, 21/21 tests
- `npm run typecheck`: passed

## Review

- Ran `codex-minimax review`.
- MiniMax saved `reviews/latest-minimax-review.md`, but it could not inspect a concrete diff in this non-git workspace and returned only a generic checklist. No actionable findings were identified from that review.

## Result

T-007 acceptance criteria are satisfied:

- TUI-facing helper can create or update spec from a discussion prompt.
- TUI-facing helper can generate or update the todo list.
- Long model output is saved exactly to artifacts and summarized separately for TUI display.
- Tests cover artifact creation and no-loss persistence for spec and todo updates.

## Risks / Blockers

- No live TUI wiring was added because T-007 write scope excludes `src/tui/**`.
- Todo parsing is deterministic YAML input only; real model invocation and prompt construction remain intentionally out of scope.
