import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  loadExecutorProfiles,
  runNextQueueItem,
  validateExecutorProfiles,
} from "../../src/worker/index.js";
import { createEmptyTaskQueue, syncQueueFromTodo } from "../../src/queue/index.js";
import { StateManager } from "../../src/state/index.js";
import type { WorkflowTodo } from "../../src/shared/types.js";

async function withTempProject<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "worker-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function todo(): WorkflowTodo {
  return {
    project: "worker-test",
    version: 1,
    goal: "run queued work",
    tasks: [
      {
        id: "T-low",
        title: "Low priority task",
        type: "coding",
        status: "ready",
        agent: "executor",
        dependencies: [],
        write_scope: ["src/low/**"],
        acceptance: ["Can run low task."],
        output: ["changed_files"],
      },
      {
        id: "T-high",
        title: "High priority task",
        type: "coding",
        status: "ready",
        agent: "executor",
        dependencies: [],
        risk: "security",
        write_scope: ["src/high/**"],
        acceptance: ["Can run high task."],
        output: ["changed_files"],
      },
    ],
  };
}

test("runNextQueueItem syncs the queue and dispatches the highest priority pending task", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    await state.saveSpec("# Worker Spec\n");
    await state.saveTodo(todo());

    const result = await runNextQueueItem({
      state,
      command: process.execPath,
      args: ["-e", "console.log('worker ok')"],
    });

    assert.equal(result.status, "executed");
    assert.equal(result.taskId, "T-high");
    assert.equal(result.dispatch?.phase, "review");
    const updatedTodo = await state.loadTodo();
    assert.equal(updatedTodo.tasks.find((task) => task.id === "T-high")?.status, "review");
    assert.equal(updatedTodo.tasks.find((task) => task.id === "T-low")?.status, "ready");
    const queue = await state.loadTaskQueue();
    assert.equal(queue.items.find((item) => item.task_id === "T-high")?.status, "review");
    assert.equal(queue.items.find((item) => item.task_id === "T-low")?.status, "pending");
    assert.match(
      await readFile(join(root, ".ai", "runs", "T-high", "stdout.log"), "utf8"),
      /worker ok/,
    );
  });
});

test("runNextQueueItem reports an empty queue without requiring an executor command", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    await state.saveTodo({ ...todo(), tasks: [] });
    await state.saveTaskQueue(createEmptyTaskQueue());

    const result = await runNextQueueItem({ state });

    assert.equal(result.status, "empty");
    assert.equal(result.taskId, undefined);
  });
});

test("runNextQueueItem can resolve an executor profile from .ai/executor-profiles.yaml", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    await state.saveSpec("# Worker Spec\n");
    await state.saveTodo(todo());
    await state.saveTaskQueue(syncQueueFromTodo(createEmptyTaskQueue(), todo()));
    await state.saveRunArtifact(
      "profiles",
      "placeholder.txt",
      "force .ai directory creation\n",
    );
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(
        join(root, ".ai", "executor-profiles.yaml"),
        [
          "version: 1",
          "default_profile: node-ok",
          "profiles:",
          "  node-ok:",
          `    command: ${JSON.stringify(process.execPath)}`,
          "    args:",
          "      - -e",
          "      - console.log('profile ok')",
          "    success_status: done",
        ].join("\n"),
        "utf8",
      ),
    );

    const profiles = await loadExecutorProfiles(state);
    assert.equal(profiles.default_profile, "node-ok");

    const result = await runNextQueueItem({ state, profile: "node-ok" });

    assert.equal(result.status, "executed");
    assert.equal(result.dispatch?.phase, "done");
    assert.match(
      await readFile(join(root, ".ai", "runs", "T-high", "stdout.log"), "utf8"),
      /profile ok/,
    );
  });
});

test("loadExecutorProfiles accepts an absolute profile path override", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    const profilePath = join(root, "profiles.yaml");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(
        profilePath,
        [
          "version: 1",
          "profiles:",
          "  node-ok:",
          `    command: ${JSON.stringify(process.execPath)}`,
        ].join("\n"),
        "utf8",
      ),
    );

    const profiles = await loadExecutorProfiles(state, profilePath);

    assert.equal(profiles.profiles["node-ok"]?.command, process.execPath);
  });
});

test("runNextQueueItem dry-run previews the next task without mutating todo or artifacts", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    await state.saveSpec("# Worker Spec\n");
    await state.saveTodo(todo());

    const result = await runNextQueueItem({
      state,
      command: process.execPath,
      args: ["-e", "console.log('should not run')"],
      dryRun: true,
    });

    assert.equal(result.status, "dry-run");
    assert.equal(result.taskId, "T-high");
    assert.match(result.preview.command, new RegExp(process.execPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
    assert.equal((await state.loadTodo()).tasks.find((task) => task.id === "T-high")?.status, "ready");
    await assert.rejects(
      () => readFile(join(root, ".ai", "runs", "T-high", "stdout.log"), "utf8"),
      /ENOENT/,
    );
    await assert.rejects(() => state.loadTaskQueue(), /ENOENT/);
  });
});

test("runNextQueueItem applies profile timeout to executor runs", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    await state.saveSpec("# Worker Spec\n");
    await state.saveTodo(todo());
    await state.saveRunArtifact("profiles", "placeholder.txt", "force .ai directory creation\n");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(
        join(root, ".ai", "executor-profiles.yaml"),
        [
          "version: 1",
          "default_profile: slow",
          "profiles:",
          "  slow:",
          `    command: ${JSON.stringify(process.execPath)}`,
          "    args:",
          "      - -e",
          "      - setTimeout(() => console.log('late'), 1000)",
          "    timeout_ms: 50",
        ].join("\n"),
        "utf8",
      ),
    );

    const result = await runNextQueueItem({ state, profile: "slow" });

    assert.equal(result.status, "executed");
    assert.equal(result.dispatch.phase, "blocked");
    const timedOutTask = (await state.loadTodo()).tasks.find((task) => task.id === "T-high") as
      | { status_reason?: string }
      | undefined;
    assert.match(timedOutTask?.status_reason ?? "", /timed out after 50ms/);
    assert.match(
      await readFile(join(root, ".ai", "runs", "T-high", "stderr.log"), "utf8"),
      /timed out after 50ms/,
    );
  });
});

test("validateExecutorProfiles reports missing default profiles and invalid timeout values", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    const profilePath = join(root, "bad-profiles.yaml");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(
        profilePath,
        [
          "version: 1",
          "default_profile: missing",
          "profiles:",
          "  bad:",
          "    command: ''",
          "    timeout_ms: -1",
        ].join("\n"),
        "utf8",
      ),
    );

    const result = await validateExecutorProfiles(state, profilePath);

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /default_profile missing/);
    assert.match(result.errors.join("\n"), /command/);
    assert.match(result.errors.join("\n"), /timeout_ms/);
  });
});
