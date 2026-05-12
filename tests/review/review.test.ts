import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  InvalidTaskTransitionError,
} from "../../src/state/index.js";
import {
  applyReviewOutcomeToTodo,
  buildReviewerRequest,
  saveReviewOutcome,
  type ReviewOutcome,
} from "../../src/review/index.js";
import type { TodoTask, WorkflowTodo } from "../../src/shared/types.js";

const task: TodoTask = {
  id: "T-010",
  title: "Implement review dispatch protocol",
  type: "coding",
  status: "review",
  agent: "executor",
  dependencies: ["T-005", "T-006", "T-008"],
  write_scope: ["src/review/**", "tests/review/**"],
  acceptance: [
    "Reviewer input includes diff, acceptance criteria, test output, and execution report.",
    "Reviewer output is saved to .ai/runs/<task-id>/review.md.",
    "Review findings can update todo status to done or fix_needed.",
  ],
  output: ["changed_files", "test_results", ".ai/runs/T-010/result.md"],
};

async function withTempProject<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "review-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function todoWithTask(currentTask: TodoTask = task): WorkflowTodo {
  return {
    project: "test",
    version: 1,
    goal: "exercise review helpers",
    tasks: [currentTask],
  };
}

test("buildReviewerRequest includes diff, acceptance criteria, test output, and execution report", () => {
  const request = buildReviewerRequest({
    task,
    diff: "diff --git a/src/review/index.ts b/src/review/index.ts\n+export const added = true;",
    testOutput: "npm test\n20 tests, 0 failures",
    executionReport: "Implemented deterministic review helpers.",
  });

  assert.equal(request.taskId, "T-010");
  assert.deepEqual(request.acceptanceCriteria, task.acceptance);
  assert.match(request.prompt, /Review dispatch for T-010/);
  assert.match(request.prompt, /Reviewer input includes diff/);
  assert.match(request.prompt, /diff --git/);
  assert.match(request.prompt, /20 tests, 0 failures/);
  assert.match(request.prompt, /Implemented deterministic review helpers/);
});

test("saveReviewOutcome writes review markdown and clean review marks todo done", async () => {
  await withTempProject(async (root) => {
    const outcome: ReviewOutcome = {
      taskId: "T-010",
      verdict: "approved",
      summary: "No actionable findings.",
      findings: [],
    };

    const reviewPath = await saveReviewOutcome(root, outcome);
    const updated = applyReviewOutcomeToTodo(todoWithTask(), outcome);

    assert.equal(reviewPath, join(root, ".ai", "runs", "T-010", "review.md"));
    assert.match(await readFile(reviewPath, "utf8"), /Verdict: approved/);
    assert.match(await readFile(reviewPath, "utf8"), /No actionable findings/);
    assert.equal(updated.tasks[0]?.status, "done");
    assert.equal(task.status, "review");
  });
});

test("actionable review findings mark todo fix_needed", () => {
  const outcome: ReviewOutcome = {
    taskId: "T-010",
    verdict: "changes_requested",
    summary: "A reviewer found a blocking issue.",
    findings: [
      {
        severity: "high",
        title: "Missing review artifact persistence",
        details: "No code path writes .ai/runs/T-010/review.md.",
        actionable: true,
      },
    ],
  };

  const updated = applyReviewOutcomeToTodo(todoWithTask(), outcome);

  assert.equal(updated.tasks[0]?.status, "fix_needed");
  assert.equal(updated.tasks[0]?.id, "T-010");
});

test("review outcome cannot bypass lifecycle transitions", () => {
  const outcome: ReviewOutcome = {
    taskId: "T-010",
    verdict: "approved",
    summary: "No actionable findings.",
    findings: [],
  };
  const draftTask: TodoTask = {
    ...task,
    status: "draft",
  };

  assert.throws(
    () => applyReviewOutcomeToTodo(todoWithTask(draftTask), outcome),
    InvalidTaskTransitionError,
  );
});
