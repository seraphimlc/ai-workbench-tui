import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  InvalidTaskTransitionError,
  StateManager,
  WriteScopeConflictError,
} from "../../src/state/index.js";
import type { WorkflowTodo } from "../../src/shared/types.js";

async function withTempProject<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "state-manager-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function todoWithTasks(tasks: WorkflowTodo["tasks"]): WorkflowTodo {
  return {
    project: "test",
    version: 1,
    goal: "exercise state manager",
    tasks,
  };
}

test("loads and saves spec, decisions, routes, todo, and run artifacts", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    const routes = {
      version: 1,
      defaults: {
        coding: {
          agent: "executor",
          model: "gpt-test",
          mode: "background",
        },
      },
    } as const;
    const todo = todoWithTasks([]);

    await state.saveSpec("# Spec\n");
    await state.saveDecisions("# Decisions\n");
    await state.saveRoutes(routes);
    await state.saveTodo(todo);
    await state.saveRunArtifact("T-999", "result.md", "result body\n");

    assert.equal(await state.loadSpec(), "# Spec\n");
    assert.equal(await state.loadDecisions(), "# Decisions\n");
    assert.deepEqual(await state.loadRoutes(), routes);
    assert.deepEqual(await state.loadTodo(), todo);
    assert.equal(await state.loadRunArtifact("T-999", "result.md"), "result body\n");
  });
});

test("allows a valid task transition", () => {
  const state = new StateManager("/unused");
  const todo = todoWithTasks([
    {
      id: "T-100",
      title: "Ready task",
      type: "coding",
      status: "draft",
      agent: "executor",
      dependencies: [],
      write_scope: ["src/state/**"],
      acceptance: ["can be made ready"],
      output: ["changed_files"],
    },
  ]);

  const updated = state.transitionTask(todo, "T-100", "ready");

  assert.equal(updated.tasks[0]?.status, "ready");
  assert.equal(todo.tasks[0]?.status, "draft");
});

test("rejects an invalid task transition", () => {
  const state = new StateManager("/unused");
  const todo = todoWithTasks([
    {
      id: "T-101",
      title: "Cannot jump",
      type: "coding",
      status: "draft",
      agent: "executor",
      dependencies: [],
      write_scope: ["src/state/**"],
      acceptance: ["cannot jump to done"],
      output: ["changed_files"],
    },
  ]);

  assert.throws(
    () => state.transitionTask(todo, "T-101", "done"),
    InvalidTaskTransitionError,
  );
});

test("rejects ready/running write-scope conflicts", () => {
  const state = new StateManager("/unused");
  const todo = todoWithTasks([
    {
      id: "T-102",
      title: "Overlapping task",
      type: "coding",
      status: "draft",
      agent: "executor",
      dependencies: [],
      write_scope: ["src/state/**"],
      acceptance: ["must not conflict"],
      output: ["changed_files"],
    },
    {
      id: "T-103",
      title: "Already running",
      type: "coding",
      status: "running",
      agent: "executor",
      dependencies: [],
      write_scope: ["src/state/index.ts"],
      acceptance: ["owns index"],
      output: ["changed_files"],
    },
  ]);

  assert.throws(
    () => state.transitionTask(todo, "T-102", "ready"),
    WriteScopeConflictError,
  );
});
