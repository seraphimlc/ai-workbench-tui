import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  createDefaultAlignmentDocument,
  loadAlignmentDocument,
  renderAlignmentCheck,
  recommendAlignmentDecision,
} from "../../src/alignment/index.js";
import { StateManager } from "../../src/state/index.js";
import type { WorkflowTodo } from "../../src/shared/types.js";

async function withTempProject<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "alignment-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function todo(statuses: WorkflowTodo["tasks"][number]["status"][]): WorkflowTodo {
  return {
    project: "alignment-test",
    version: 1,
    goal: "keep aligned",
    tasks: statuses.map((status, index) => ({
      id: `T-${index + 1}`,
      title: `Task ${index + 1}`,
      type: "coding",
      status,
      agent: "executor",
      dependencies: [],
      write_scope: [`src/task-${index + 1}/**`],
      acceptance: ["stays aligned"],
      output: ["changed_files"],
    })),
  };
}

test("loadAlignmentDocument parses the objective lock sections", async () => {
  await withTempProject(async (root) => {
    await mkdir(join(root, ".ai"), { recursive: true });
    await writeFile(
      join(root, ".ai", "alignment.md"),
      [
        "# Alignment Checkpoint",
        "",
        "## Goal",
        "",
        "- Keep the worker bounded.",
        "",
        "## Non-goals",
        "",
        "- Do not add provider adapters.",
        "",
        "## Stop Conditions",
        "",
        "- Stop when the success criteria are complete.",
        "",
        "## Success Criteria",
        "",
        "- align command renders.",
      ].join("\n"),
      "utf8",
    );

    const document = await loadAlignmentDocument(root);

    assert.equal(document.exists, true);
    assert.deepEqual(document.goal, ["Keep the worker bounded."]);
    assert.deepEqual(document.nonGoals, ["Do not add provider adapters."]);
    assert.deepEqual(document.stopConditions, [
      "Stop when the success criteria are complete.",
    ]);
    assert.deepEqual(document.successCriteria, ["align command renders."]);
  });
});

test("recommendAlignmentDecision stops when all todo tasks are done", () => {
  const decision = recommendAlignmentDecision(todo(["done", "done"]));

  assert.equal(decision.kind, "stop");
  assert.match(decision.reason, /All tracked tasks are done/);
});

test("recommendAlignmentDecision asks for human input on blocked or fix-needed tasks", () => {
  const decision = recommendAlignmentDecision(todo(["done", "blocked", "fix_needed"]));

  assert.equal(decision.kind, "ask-human");
  assert.match(decision.reason, /blocked or need fixes/);
});

test("renderAlignmentCheck includes missing-file guidance and current decision", async () => {
  await withTempProject(async (root) => {
    const state = new StateManager(root);
    await state.saveTodo(todo(["ready"]));

    const output = await renderAlignmentCheck(root);

    assert.match(output, /Alignment:/);
    assert.match(output, /alignment.md not found/);
    assert.match(output, /Decision: continue/);
  });
});

test("createDefaultAlignmentDocument renders the required sections", () => {
  const output = createDefaultAlignmentDocument({
    goal: "Add alignment checkpoints.",
  });

  assert.match(output, /## Goal/);
  assert.match(output, /Add alignment checkpoints/);
  assert.match(output, /## Non-goals/);
  assert.match(output, /## Stop Conditions/);
  assert.match(output, /## Success Criteria/);
});
