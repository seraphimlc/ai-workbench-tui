import assert from "node:assert/strict";
import test from "node:test";

import {
  applyExecutorRunResultToTodo,
  buildRunStatusSummary,
  markInterruptedRunsBlocked,
  markTaskRunStarted,
  type ExecutorRunResult,
} from "../../src/execution/index.js";
import type { TodoTask, WorkflowTodo } from "../../src/shared/types.js";

const baseTask: TodoTask = {
  id: "T-009",
  title: "Implement run monitor and task status updates",
  type: "coding",
  status: "ready",
  agent: "executor",
  dependencies: ["T-008"],
  write_scope: ["src/execution/**", "tests/execution/**"],
  acceptance: ["status updates"],
  output: ["changed_files", "test_results"],
};

function todoWithTask(task: TodoTask): WorkflowTodo {
  return {
    project: "test",
    version: 1,
    goal: "exercise run monitor",
    tasks: [task],
  };
}

function result(overrides: Partial<ExecutorRunResult> = {}): ExecutorRunResult {
  return {
    stdout: "ok\n",
    stderr: "",
    exitCode: 0,
    signal: null,
    startedAt: "2026-05-12T00:00:00.000Z",
    endedAt: "2026-05-12T00:00:01.000Z",
    durationMs: 1000,
    artifactPaths: {
      handoff: ".ai/runs/T-009/handoff.md",
      stdout: ".ai/runs/T-009/stdout.log",
      stderr: ".ai/runs/T-009/stderr.log",
      result: ".ai/runs/T-009/result.json",
    },
    ...overrides,
  };
}

test("marks a ready task running and moves successful runs to review with a summary", () => {
  const started = markTaskRunStarted(todoWithTask(baseTask), "T-009", {
    now: "2026-05-12T00:00:00.000Z",
  });

  assert.equal(started.todo.tasks[0]?.status, "running");
  assert.equal(started.summary.phase, "running");
  assert.equal(started.summary.taskId, "T-009");
  assert.equal(started.summary.startedAt, "2026-05-12T00:00:00.000Z");

  const finished = applyExecutorRunResultToTodo(started.todo, "T-009", result());

  assert.equal(finished.todo.tasks[0]?.status, "review");
  assert.equal(finished.summary.phase, "review");
  assert.equal(finished.summary.ok, true);
  assert.equal(finished.summary.reason, undefined);
  assert.deepEqual(finished.summary.artifacts, result().artifactPaths);
});

test("can promote a successful run through review to done when review is not required", () => {
  const started = markTaskRunStarted(todoWithTask(baseTask), "T-009");
  const finished = applyExecutorRunResultToTodo(started.todo, "T-009", result(), {
    successStatus: "done",
  });

  assert.equal(finished.todo.tasks[0]?.status, "done");
  assert.equal(finished.summary.phase, "done");
});

test("marks failed runs blocked with a concise reason and truncated log preview", () => {
  const started = markTaskRunStarted(todoWithTask(baseTask), "T-009");
  const failed = applyExecutorRunResultToTodo(
    started.todo,
    "T-009",
    result({
      exitCode: 2,
      stderr: `${"noise\n".repeat(20)}fatal: command failed\n`,
      stdout: "a".repeat(500),
    }),
    { maxPreviewCharacters: 80 },
  );

  assert.equal(failed.todo.tasks[0]?.status, "blocked");
  assert.equal(failed.summary.phase, "blocked");
  assert.equal(failed.summary.ok, false);
  assert.match(failed.summary.reason ?? "", /exit code 2/);
  assert.match(failed.summary.stderrPreview ?? "", /fatal: command failed/);
  assert.ok((failed.summary.stdoutPreview ?? "").length <= 80);
});

test("marks review-stage process failures fix_needed when requested", () => {
  const reviewTodo = todoWithTask({ ...baseTask, status: "review" });
  const failed = applyExecutorRunResultToTodo(
    reviewTodo,
    "T-009",
    result({ exitCode: 1, stderr: "review found a regression\n" }),
    { failureStatus: "fix_needed" },
  );

  assert.equal(failed.todo.tasks[0]?.status, "fix_needed");
  assert.equal(failed.summary.phase, "fix_needed");
  assert.match(failed.summary.reason ?? "", /exit code 1/);
});

test("summarizes live and completed runs without full logs", () => {
  const live = buildRunStatusSummary({
    taskId: "T-009",
    phase: "running",
    startedAt: "2026-05-12T00:00:00.000Z",
    stdout: "line 1\nline 2\nline 3\n",
    stderr: "warning\n",
    maxPreviewCharacters: 10,
  });

  assert.equal(live.phase, "running");
  assert.equal(live.ok, undefined);
  assert.equal(live.stdoutPreview, "e 2\nline 3");
  assert.equal(live.stderrPreview, "warning");
  assert.equal(live.stdoutBytes, 21);
  assert.equal(live.stderrBytes, 8);
});

test("recovers interrupted running tasks by marking stale runs blocked", () => {
  const todo = todoWithTask({ ...baseTask, status: "running" });
  const recovered = markInterruptedRunsBlocked(todo, [
    {
      taskId: "T-009",
      reason: "executor disappeared before writing result.json",
      endedAt: "2026-05-12T00:10:00.000Z",
    },
  ]);

  assert.equal(recovered.todo.tasks[0]?.status, "blocked");
  assert.equal(recovered.summaries[0]?.phase, "blocked");
  assert.equal(recovered.summaries[0]?.ok, false);
  assert.match(recovered.summaries[0]?.reason ?? "", /executor disappeared/);
});
