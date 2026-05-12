import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { runIterateCommand } from "../../src/commands/iterate/index.js";
import {
  buildExecutorHandoffPrompt,
  runExecutorProcess,
} from "../../src/execution/index.js";
import { createNextIterationNote } from "../../src/iterations/index.js";
import {
  applyReviewOutcomeToTodo,
  saveReviewOutcome,
  type ReviewOutcome,
} from "../../src/review/index.js";
import { StateManager } from "../../src/state/index.js";
import type { TodoTask, WorkflowTodo } from "../../src/shared/types.js";

async function withTempProject<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "ai-workbench-e2e-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const task: TodoTask = {
  id: "T-e2e",
  title: "Exercise fake executor flow",
  type: "coding",
  status: "ready",
  agent: "executor",
  dependencies: [],
  write_scope: ["src/fake/**"],
  acceptance: ["Executor writes expected output."],
  output: ["changed_files", "test_results", ".ai/runs/T-e2e/result.md"],
};

function todoWithTask(currentTask: TodoTask): WorkflowTodo {
  return {
    project: "e2e",
    version: 1,
    goal: "smoke flow",
    tasks: [currentTask],
  };
}

test("MVP flow creates spec, todo, executor artifacts, review, iteration, and TUI output", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    const cliPath = fileURLToPath(new URL("../../src/tui/cli.js", import.meta.url));
    const specOutput = join(root, "spec-output.md");
    const todoOutput = join(root, "todo-output.yaml");

    await writeFile(specOutput, "# E2E Spec\n\nExercise the complete MVP flow.\n", "utf8");
    await writeFile(
      todoOutput,
      [
        "tasks:",
        "  - id: T-e2e",
        "    title: Exercise fake executor flow",
        "    type: coding",
        "    status: ready",
        "    agent: executor",
        "    dependencies: []",
        "    write_scope:",
        "      - src/fake/**",
        "    acceptance:",
        "      - Executor writes expected output.",
        "    output:",
        "      - changed_files",
        "      - test_results",
        "      - .ai/runs/T-e2e/result.md",
      ].join("\n"),
      "utf8",
    );

    const plan = spawnSync(
      process.execPath,
      [
        cliPath,
        "plan",
        "--cwd",
        root,
        "--prompt",
        "Create e2e artifacts",
        "--spec-output",
        specOutput,
        "--todo-output",
        todoOutput,
      ],
      { encoding: "utf8" },
    );

    assert.equal(plan.status, 0, plan.stderr);
    assert.match(plan.stdout, /Spec update:/);
    assert.match(plan.stdout, /Todo update:/);

    const loadedTodo = await state.loadTodo();
    assert.equal(loadedTodo.tasks[0]?.id, "T-e2e");

    const handoff = buildExecutorHandoffPrompt({
      spec: await state.loadSpec(),
      task,
    });
    const run = await runExecutorProcess({
      command: process.execPath,
      args: ["-e", "console.log('fake executor ok')"],
      cwd: root,
      runDir: join(root, ".ai", "runs", "T-e2e"),
      handoffPrompt: handoff,
    });
    const runResult = await run.completed;

    assert.equal(runResult.exitCode, 0);
    assert.equal(await readFile(runResult.artifactPaths.stdout, "utf8"), "fake executor ok\n");
    assert.match(await readFile(runResult.artifactPaths.handoff, "utf8"), /Executor handoff/);

    const approved: ReviewOutcome = {
      taskId: "T-e2e",
      verdict: "approved",
      summary: "Fake executor output satisfies the smoke criteria.",
      findings: [],
    };
    await saveReviewOutcome(root, approved);
    await state.saveTodo(applyReviewOutcomeToTodo({ ...loadedTodo, tasks: [{ ...task, status: "review" }] }, approved));
    assert.equal((await state.loadTodo()).tasks[0]?.status, "done");

    const changesRequested: ReviewOutcome = {
      taskId: "T-e2e",
      verdict: "changes_requested",
      summary: "Need a follow-up fix task.",
      findings: [
        {
          severity: "medium",
          title: "Add real executor wiring",
          details: "The smoke flow uses a fake executor.",
          actionable: true,
        },
      ],
    };
    await state.saveTodo({ ...loadedTodo, tasks: [{ ...task, status: "review" }] });
    await saveReviewOutcome(root, changesRequested);
    await runIterateCommand({ state, taskId: "T-e2e", decision: { kind: "accept" } });
    assert.ok((await state.loadTodo()).tasks.some((candidate) => candidate.id === "T-e2e-FIX-001"));

    await createNextIterationNote(root, {
      title: "E2E Smoke",
      values: {
        trigger: "E2E smoke test",
        reviewSummary: "Review produced a follow-up fix task.",
      },
    });
    const iterations = spawnSync(process.execPath, [cliPath, "iterations", "--cwd", root], {
      encoding: "utf8",
    });

    assert.equal(iterations.status, 0, iterations.stderr);
    assert.match(iterations.stdout, /E2E Smoke/);
  });
});
