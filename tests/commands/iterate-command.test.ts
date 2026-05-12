import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  applyIterationProposalDecision,
  proposeTodoChangesFromReview,
  runIterateCommand,
  type IterationProposal,
} from "../../src/commands/iterate/index.js";
import { saveReviewOutcome, type ReviewOutcome } from "../../src/review/index.js";
import { StateManager } from "../../src/state/index.js";
import type { TodoTask, WorkflowTodo } from "../../src/shared/types.js";

const reviewedTask: TodoTask = {
  id: "T-100",
  title: "Add review-aware command",
  type: "coding",
  status: "review",
  agent: "executor",
  dependencies: ["T-001"],
  write_scope: ["src/commands/example/**", "tests/commands/**"],
  acceptance: ["Command reads review results."],
  output: ["changed_files", "test_results", ".ai/runs/T-100/result.md"],
};

async function withTempProject<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "iterate-command-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function todoWithTasks(tasks: TodoTask[]): WorkflowTodo {
  return {
    project: "test",
    version: 1,
    goal: "exercise iteration command",
    tasks,
  };
}

function changesRequestedOutcome(): ReviewOutcome {
  return {
    taskId: "T-100",
    verdict: "changes_requested",
    summary: "One acceptance criterion still needs work.",
    findings: [
      {
        severity: "high",
        title: "Review artifact is not read",
        details: "The command never loads .ai/runs/T-100/review.md before proposing fixes.",
        actionable: true,
        file: "src/commands/example/index.ts",
      },
    ],
  };
}

test("runIterateCommand reads a review artifact and accepted fix-needed proposals update todos", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    await state.saveTodo(todoWithTasks([reviewedTask]));
    await saveReviewOutcome(root, changesRequestedOutcome());

    const result = await runIterateCommand({
      state,
      taskId: "T-100",
      decision: { kind: "accept" },
    });

    const todo = await state.loadTodo();
    const fixTask = todo.tasks.find((task) => task.id === "T-100-FIX-001");

    assert.equal(result.proposal.taskId, "T-100");
    assert.equal(result.decision.kind, "accept");
    assert.equal(todo.tasks.find((task) => task.id === "T-100")?.status, "fix_needed");
    assert.equal(fixTask?.title, "Fix review finding: Review artifact is not read");
    assert.equal(fixTask?.status, "draft");
    assert.deepEqual(fixTask?.dependencies, ["T-001"]);
    assert.deepEqual(fixTask?.write_scope, ["src/commands/example/index.ts"]);
    assert.match(result.markdownSummary, /T-100-FIX-001/);
  });
});

test("iteration proposal decisions support reject and edit without mutating the proposal", () => {
  const proposal = proposeTodoChangesFromReview(
    todoWithTasks([reviewedTask]),
    changesRequestedOutcome(),
  );
  const rejected = applyIterationProposalDecision(todoWithTasks([reviewedTask]), proposal, {
    kind: "reject",
  });
  const editedProposal: IterationProposal = {
    ...proposal,
    changes: proposal.changes.map((change) =>
      change.kind === "upsert_task"
        ? {
            ...change,
            task: {
              ...change.task,
              title: "Fix edited review scope",
              write_scope: ["src/commands/iterate/**"],
            },
          }
        : change,
    ),
  };
  const edited = applyIterationProposalDecision(todoWithTasks([reviewedTask]), proposal, {
    kind: "edit",
    proposal: editedProposal,
  });

  assert.equal(rejected.applied, false);
  assert.deepEqual(rejected.todo.tasks, [reviewedTask]);
  assert.equal(edited.applied, true);
  assert.equal(
    edited.todo.tasks.find((task) => task.id === "T-100-FIX-001")?.title,
    "Fix edited review scope",
  );
  assert.deepEqual(
    edited.todo.tasks.find((task) => task.id === "T-100-FIX-001")?.write_scope,
    ["src/commands/iterate/**"],
  );
  assert.equal(
    proposal.changes.find((change) => change.kind === "upsert_task")?.task.title,
    "Fix review finding: Review artifact is not read",
  );
});

test("existing fix task upsert preserves status and rejects status regressions", () => {
  const existingFixTask: TodoTask = {
    ...reviewedTask,
    id: "T-100-FIX-001",
    title: "Existing fix task",
    status: "done",
    dependencies: ["T-001"],
    write_scope: ["src/commands/example/index.ts"],
  };
  const todo = todoWithTasks([reviewedTask, existingFixTask]);
  const proposal = proposeTodoChangesFromReview(todo, changesRequestedOutcome());
  const applied = applyIterationProposalDecision(todo, proposal, { kind: "accept" });

  assert.equal(applied.todo.tasks.find((task) => task.id === "T-100-FIX-001")?.status, "done");
  assert.equal(
    applied.todo.tasks.find((task) => task.id === "T-100-FIX-001")?.title,
    "Fix review finding: Review artifact is not read",
  );
});
