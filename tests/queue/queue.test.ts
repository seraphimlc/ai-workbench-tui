import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createEmptyTaskQueue,
  getDispatchableTasks,
  getNextQueueItems,
  renderTaskQueue,
  syncQueueFromTodo,
  updateQueueItemStatus,
} from "../../src/queue/index.js";
import type { TodoTask, WorkflowTodo } from "../../src/shared/types.js";

function task(overrides: Partial<TodoTask>): TodoTask {
  return {
    id: "T-1",
    title: "Ready task",
    type: "coding",
    status: "ready",
    agent: "executor",
    dependencies: [],
    write_scope: ["src/**"],
    acceptance: ["works"],
    output: ["changed_files"],
    ...overrides,
  };
}

function todo(tasks: TodoTask[]): WorkflowTodo {
  return {
    project: "queue-test",
    version: 1,
    goal: "queue tasks",
    tasks,
  };
}

test("getDispatchableTasks only returns ready tasks with satisfied dependencies", () => {
  const tasks = [
    task({ id: "T-done", status: "done" }),
    task({ id: "T-ready", dependencies: ["T-done"] }),
    task({ id: "T-blocked", dependencies: ["T-missing"] }),
    task({ id: "T-draft", status: "draft" }),
    task({ id: "T-no-acceptance", acceptance: [] }),
  ];

  assert.deepEqual(
    getDispatchableTasks(todo(tasks)).map((candidate) => candidate.id),
    ["T-ready"],
  );
});

test("syncQueueFromTodo adds dispatchable tasks once and keeps queue order stable", () => {
  const synced = syncQueueFromTodo(
    createEmptyTaskQueue(),
    todo([
      task({ id: "T-low", dependencies: ["T-done"] }),
      task({ id: "T-high", risk: "security" }),
      task({ id: "T-done", status: "done" }),
    ]),
    { now: "2026-05-12T00:00:00.000Z", projectId: "queue-test" },
  );

  assert.deepEqual(
    getNextQueueItems(synced).map((item) => item.task_id),
    ["T-high", "T-low"],
  );
  assert.equal(synced.items[0]?.project_id, "queue-test");
  assert.match(renderTaskQueue(synced), /T-high pending p100/);

  const resynced = syncQueueFromTodo(synced, todo([task({ id: "T-high", risk: "security" })]));
  assert.equal(resynced.items.length, 1);
  assert.equal(resynced.items[0]?.enqueued_at, "2026-05-12T00:00:00.000Z");
});

test("updateQueueItemStatus updates a queued task and rejects unknown tasks", () => {
  const queue = syncQueueFromTodo(createEmptyTaskQueue(), todo([task({ id: "T-1" })]), {
    now: "2026-05-12T00:00:00.000Z",
  });

  const updated = updateQueueItemStatus(queue, "T-1", "running", {
    now: "2026-05-12T01:00:00.000Z",
    reason: "executor started",
  });

  assert.equal(updated.items[0]?.status, "running");
  assert.equal(updated.items[0]?.reason, "executor started");
  assert.equal(updated.items[0]?.updated_at, "2026-05-12T01:00:00.000Z");
  assert.throws(() => updateQueueItemStatus(updated, "missing", "blocked"), /Queue item/);
});
