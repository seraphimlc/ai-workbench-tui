# Alignment Checkpoint

## Goal

- Keep ai-workbench-tui aligned while adding only the smallest workflow controls that prevent autonomous drift.

## Non-goals

- Do not add model provider adapters in the current objective.
- Do not add daemon/watch execution in the current objective.
- Do not turn alignment into a blocking approval workflow.

## Stop Conditions

- Stop when all tasks in the active objective are done and verified.
- Pause before adding capabilities outside the current objective lock.
- Pause if the next step is consolidation or commit hygiene rather than new capability.

## Success Criteria

- `align` shows the objective lock and current stop/continue recommendation.
- Iteration notes include a Stop / Continue Decision.
- The mechanism remains advisory and does not block normal commands.
