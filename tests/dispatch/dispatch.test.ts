import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { dispatchExecutorCommand } from "../../src/dispatch/index.js";
import { StateManager } from "../../src/state/index.js";
import type { WorkflowTodo } from "../../src/shared/types.js";

async function withTempProject<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "dispatch-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function todo(status: WorkflowTodo["tasks"][number]["status"] = "ready"): WorkflowTodo {
  return {
    project: "dispatch-test",
    version: 1,
    goal: "dispatch external commands",
    tasks: [
      {
        id: "T-dispatch",
        title: "Dispatch executor command",
        type: "coding",
        status,
        agent: "executor",
        dependencies: [],
        write_scope: ["src/dispatch/**"],
        acceptance: ["Executor command is captured."],
        output: ["changed_files", "test_results"],
      },
    ],
  };
}

test("dispatchExecutorCommand runs an external command and persists todo, queue, history, and artifacts", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    await state.saveSpec("# Dispatch Spec\n");
    await state.saveTodo(todo());

    const result = await dispatchExecutorCommand({
      state,
      taskId: "T-dispatch",
      command: process.execPath,
      args: ["-e", "console.log('ok')"],
    });

    assert.equal(result.ok, true);
    assert.equal(result.phase, "review");
    assert.equal((await state.loadTodo()).tasks[0]?.status, "review");
    assert.equal((await state.loadTaskQueue()).items[0]?.status, "review");
    assert.equal((await state.loadRunHistory()).entries[0]?.status, "review");
    assert.match(
      await readFile(join(root, ".ai", "runs", "T-dispatch", "handoff.md"), "utf8"),
      /Executor handoff/,
    );
    assert.match(
      await readFile(join(root, ".ai", "runs", "T-dispatch", "stdout.log"), "utf8"),
      /ok/,
    );
  });
});

test("dispatchExecutorCommand marks failed commands blocked", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    await writeFile(join(root, "README.md"), "dispatch fixture\n", "utf8");
    await state.saveSpec("# Dispatch Spec\n");
    await state.saveTodo(todo());

    const result = await dispatchExecutorCommand({
      state,
      taskId: "T-dispatch",
      command: process.execPath,
      args: ["-e", "process.exit(7)"],
    });

    assert.equal(result.ok, false);
    assert.equal(result.phase, "blocked");
    assert.equal((await state.loadTodo()).tasks[0]?.status, "blocked");
    assert.equal((await state.loadTaskQueue()).items[0]?.status, "blocked");
    assert.match((await state.loadRunHistory()).entries[0]?.summary ?? "", /exit code 7/);
  });
});

test("dispatchExecutorCommand recovers missing executor commands as blocked runs", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    await state.saveSpec("# Dispatch Spec\n");
    await state.saveTodo(todo());

    const result = await dispatchExecutorCommand({
      state,
      taskId: "T-dispatch",
      command: "definitely-missing-ai-workbench-command",
    });

    assert.equal(result.ok, false);
    assert.equal(result.phase, "blocked");
    assert.equal((await state.loadTodo()).tasks[0]?.status, "blocked");
    assert.equal((await state.loadTaskQueue()).items[0]?.status, "blocked");
    assert.match(
      await readFile(join(root, ".ai", "runs", "T-dispatch", "stderr.log"), "utf8"),
      /definitely-missing-ai-workbench-command|ENOENT/,
    );
  });
});
