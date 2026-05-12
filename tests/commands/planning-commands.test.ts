import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { generateOrUpdateTodoFromDiscussion } from "../../src/commands/plan/index.js";
import { createOrUpdateSpecFromDiscussion } from "../../src/commands/spec/index.js";
import { StateManager } from "../../src/state/index.js";
import type { WorkflowTodo } from "../../src/shared/types.js";

async function withTempProject<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "planning-commands-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function emptyTodo(): WorkflowTodo {
  return {
    project: "test",
    version: 1,
    goal: "test planning",
    tasks: [],
  };
}

test("creates a spec from discussion and saves full model output as an artifact", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    const modelOutput = [
      "# Updated Product Spec",
      "",
      "The system should keep discussion separate from execution.",
      "x".repeat(2_000),
    ].join("\n");

    const result = await createOrUpdateSpecFromDiscussion({
      state,
      discussionPrompt: "Turn this discussion into a durable spec.",
      modelOutput,
      artifactName: "spec-output.md",
      artifactTaskId: "planning",
    });

    assert.match(await state.loadSpec(), /Updated Product Spec/);
    assert.equal(
      await state.loadRunArtifact("planning", "spec-output.md"),
      modelOutput,
    );
    assert.equal(result.artifact.path, ".ai/runs/planning/spec-output.md");
    assert.ok(result.summary.some((line) => line.includes("artifact")));
    assert.ok(
      result.summary.join("\n").length < modelOutput.length,
      "TUI summary should not inline long model output",
    );
  });
});

test("updates an existing spec without dropping earlier content", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    await state.saveSpec("# Existing Spec\n\nKeep this section.\n");

    await createOrUpdateSpecFromDiscussion({
      state,
      discussionPrompt: "Add planning details.",
      modelOutput: "## Planning\n\nAdd bounded executor tasks.",
      artifactTaskId: "planning",
    });

    const spec = await state.loadSpec();
    assert.match(spec, /# Existing Spec/);
    assert.match(spec, /Keep this section/);
    assert.match(spec, /Add bounded executor tasks/);
  });
});

test("generates a todo list from deterministic model output and saves an artifact", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    await state.saveTodo(emptyTodo());

    const modelOutput = [
      "tasks:",
      "  - id: T-100",
      "    title: Write handoff",
      "    type: coding",
      "    status: draft",
      "    agent: executor",
      "    dependencies: []",
      "    write_scope:",
      "      - src/execution/**",
      "    acceptance:",
      "      - Handoff is deterministic.",
      "    output:",
      "      - changed_files",
    ].join("\n");

    const result = await generateOrUpdateTodoFromDiscussion({
      state,
      discussionPrompt: "Generate executor todo.",
      modelOutput,
      artifactName: "todo-output.yaml",
      artifactTaskId: "planning",
    });

    const todo = await state.loadTodo();
    assert.equal(todo.tasks.length, 1);
    assert.equal(todo.tasks[0]?.id, "T-100");
    assert.equal(
      await state.loadRunArtifact("planning", "todo-output.yaml"),
      modelOutput,
    );
    assert.match(result.summary.join("\n"), /added 1/);
  });
});

test("updates matching todo tasks while preserving unrelated existing tasks", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    await state.saveTodo({
      project: "test",
      version: 1,
      goal: "preserve tasks",
      tasks: [
        {
          id: "T-keep",
          title: "Do not lose me",
          type: "coding",
          status: "ready",
          agent: "executor",
          dependencies: [],
          write_scope: ["src/keep/**"],
          acceptance: ["still present"],
          output: ["changed_files"],
        },
        {
          id: "T-update",
          title: "Old title",
          type: "coding",
          status: "draft",
          agent: "executor",
          dependencies: [],
          write_scope: ["src/old/**"],
          acceptance: ["old acceptance"],
          output: ["changed_files"],
        },
      ],
    });

    await generateOrUpdateTodoFromDiscussion({
      state,
      discussionPrompt: "Update one task.",
      modelOutput: [
        "tasks:",
        "  - id: T-update",
        "    title: New title",
        "    type: coding",
        "    status: draft",
        "    agent: executor",
        "    dependencies: []",
        "    write_scope:",
        "      - src/new/**",
        "    acceptance:",
        "      - new acceptance",
        "    output:",
        "      - result.md",
      ].join("\n"),
    });

    const todo = await state.loadTodo();
    assert.equal(todo.tasks.length, 2);
    assert.equal(todo.tasks.find((task) => task.id === "T-keep")?.title, "Do not lose me");
    assert.equal(todo.tasks.find((task) => task.id === "T-update")?.title, "New title");
    assert.deepEqual(todo.tasks.find((task) => task.id === "T-update")?.write_scope, [
      "src/new/**",
    ]);
  });
});

test("falls back to creating project files when spec and todo do not exist", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    await writeFile(join(root, "README.md"), "temp project\n", "utf8");

    await createOrUpdateSpecFromDiscussion({
      state,
      discussionPrompt: "Draft the initial spec.",
      modelOutput: "# Initial Spec\n",
    });
    await generateOrUpdateTodoFromDiscussion({
      state,
      discussionPrompt: "Plan the first task.",
      modelOutput: "tasks: []",
    });

    assert.match(await state.loadSpec(), /Initial Spec/);
    assert.deepEqual((await state.loadTodo()).tasks, []);
  });
});

test("todo updates reject invalid lifecycle transitions from model output", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    await state.saveTodo({
      project: "test",
      version: 1,
      goal: "guard transitions",
      tasks: [
        {
          id: "T-done",
          title: "Already done",
          type: "coding",
          status: "done",
          agent: "executor",
          dependencies: [],
          write_scope: ["src/done/**"],
          acceptance: ["done"],
          output: ["changed_files"],
        },
      ],
    });

    await assert.rejects(
      () =>
        generateOrUpdateTodoFromDiscussion({
          state,
          discussionPrompt: "Do not reopen done work.",
          modelOutput: [
            "tasks:",
            "  - id: T-done",
            "    title: Reopened task",
            "    type: coding",
            "    status: ready",
            "    agent: executor",
            "    dependencies: []",
            "    write_scope:",
            "      - src/done/**",
            "    acceptance:",
            "      - should not reopen",
            "    output:",
            "      - changed_files",
          ].join("\n"),
        }),
      /Invalid task transition/,
    );
  });
});

test("todo updates reject ready tasks without dispatchable fields", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    await state.saveTodo(emptyTodo());

    await assert.rejects(
      () =>
        generateOrUpdateTodoFromDiscussion({
          state,
          discussionPrompt: "Reject empty acceptance ready task.",
          modelOutput: [
            "tasks:",
            "  - id: T-empty",
            "    title: Empty acceptance",
            "    type: coding",
            "    status: ready",
            "    agent: executor",
            "    dependencies: []",
            "    write_scope:",
            "      - src/empty/**",
            "    acceptance: []",
            "    output:",
            "      - changed_files",
          ].join("\n"),
        }),
      /acceptance/,
    );
  });
});

test("todo updates reject ready write-scope conflicts", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    await state.saveTodo({
      project: "test",
      version: 1,
      goal: "guard conflicts",
      tasks: [
        {
          id: "T-existing",
          title: "Existing ready",
          type: "coding",
          status: "ready",
          agent: "executor",
          dependencies: [],
          write_scope: ["src/**"],
          acceptance: ["existing"],
          output: ["changed_files"],
        },
      ],
    });

    await assert.rejects(
      () =>
        generateOrUpdateTodoFromDiscussion({
          state,
          discussionPrompt: "Reject conflicting ready task.",
          modelOutput: [
            "tasks:",
            "  - id: T-new",
            "    title: Conflicting ready",
            "    type: coding",
            "    status: ready",
            "    agent: executor",
            "    dependencies: []",
            "    write_scope:",
            "      - src/foo.ts",
            "    acceptance:",
            "      - should conflict",
            "    output:",
            "      - changed_files",
          ].join("\n"),
        }),
      /Write scope conflict/,
    );
  });
});
