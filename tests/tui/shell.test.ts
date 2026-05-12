import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  createTuiIterationDashboard,
  getTuiCommands,
  handleTuiCommand,
  renderTuiShell,
  type TuiShellState,
} from "../../src/tui/index.js";

const shellState: TuiShellState = {
  discussion: ["Discuss the next bounded task.", "Capture decisions before dispatch."],
  specTodo: ["T-004 Build initial TUI shell", "T-005 Implement state manager"],
  runs: ["T-004 running", "T-003 done"],
  logs: ["Loaded workflow todo.", "No active errors."],
};

test("renderTuiShell renders the four MVP panes and command hints", () => {
  const output = renderTuiShell(shellState, { width: 96 });

  assert.match(output, /DISCUSSION/);
  assert.match(output, /SPEC \/ TODO/);
  assert.match(output, /RUNS \/ REVIEW/);
  assert.match(output, /LOG/);
  assert.match(output, /status/);
  assert.match(output, /todo/);
  assert.match(output, /next/);
  assert.match(output, /plan/);
  assert.match(output, /run <task-id>/);
  assert.match(output, /review <task-id>/);
  assert.match(output, /queue/);
  assert.match(output, /history/);
  assert.match(output, /projects/);
  assert.match(output, /quit/);
});

test("required TUI commands are registered with shortcuts", () => {
  const commandNames = getTuiCommands().map((command) => command.name);

  assert.deepEqual(commandNames, [
    "status",
    "todo",
    "next",
    "plan",
    "run",
    "review",
    "queue",
    "history",
    "projects",
    "iterations",
    "iteration-draft",
    "quit",
  ]);
  for (const command of getTuiCommands()) {
    assert.ok(command.shortcut.length > 0, `${command.name} should expose a shortcut`);
  }
});

test("handleTuiCommand recognizes status, plan, run, review, iterations, draft, and quit", () => {
  assert.equal(handleTuiCommand("status").kind, "status");
  assert.equal(handleTuiCommand("todo").kind, "todo");
  assert.equal(handleTuiCommand("next").kind, "next");
  assert.equal(handleTuiCommand("plan").kind, "plan");
  assert.deepEqual(handleTuiCommand("run T-004"), { kind: "run", taskId: "T-004" });
  assert.deepEqual(handleTuiCommand("review T-004"), { kind: "review", taskId: "T-004" });
  assert.equal(handleTuiCommand("queue").kind, "queue");
  assert.equal(handleTuiCommand("history").kind, "history");
  assert.equal(handleTuiCommand("projects").kind, "projects");
  assert.equal(handleTuiCommand("iterations").kind, "iterations");
  assert.deepEqual(handleTuiCommand("iteration-draft Post Review Memory"), {
    kind: "iteration-draft",
    title: "Post Review Memory",
  });
  assert.equal(handleTuiCommand("quit").kind, "quit");
});

test("renderTuiShell renders latest iteration dashboard data", async () => {
  const root = mkdtempSync(join(tmpdir(), "tui-iterations-"));
  try {
    mkdirSync(join(root, ".ai", "iterations"), { recursive: true });
    writeFileSync(
      join(root, ".ai", "iterations", "0001-foundation.md"),
      [
        "# Iteration 0001: Foundation",
        "",
        "## Current Capability",
        "",
        "- Existing shell only.",
        "",
        "## Remaining Gaps",
        "",
        "- Older gap.",
        "",
        "## Next Iteration Recommendation",
        "",
        "Do older work.",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(root, ".ai", "iterations", "0002-round-two.md"),
      [
        "# Iteration 0002: Round Two",
        "",
        "## Current Capability",
        "",
        "- Dashboard can read latest notes.",
        "- Command hints include iterations.",
        "",
        "## Remaining Gaps",
        "",
        "- Draft creation still needs review context.",
        "",
        "## Next Iteration Recommendation",
        "",
        "Create the next review-backed iteration draft.",
      ].join("\n"),
      "utf8",
    );

    const output = renderTuiShell(
      {
        ...shellState,
        iterationDashboard: await createTuiIterationDashboard(root),
      },
      { width: 108, paneHeight: 7 },
    );

    assert.match(output, /ITERATION DASHBOARD/);
    assert.match(output, /Latest: Iteration 0002 - Round Two/);
    assert.match(output, /Current Capability/);
    assert.match(output, /Dashboard can read latest notes/);
    assert.match(output, /Remaining Gaps/);
    assert.match(output, /Draft creation still needs review context/);
    assert.match(output, /Next Recommendation/);
    assert.match(output, /Create the next review-backed iteration draft/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI can render once and exit without crashing", () => {
  const cliPath = fileURLToPath(new URL("../../src/tui/cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [cliPath, "--render-once"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DISCUSSION/);
  assert.match(result.stdout, /SPEC \/ TODO/);
  assert.match(result.stdout, /RUNS \/ REVIEW/);
  assert.match(result.stdout, /LOG/);
});

test("CLI plan command creates spec and todo artifacts from model output files", () => {
  const cliPath = fileURLToPath(new URL("../../src/tui/cli.js", import.meta.url));
  const root = mkdtempSync(join(tmpdir(), "tui-plan-"));
  try {
    const specOutput = join(root, "spec-output.md");
    const todoOutput = join(root, "todo-output.yaml");
    writeFileSync(specOutput, "# Planned Spec\n\nDiscussed capability.\n", "utf8");
    writeFileSync(
      todoOutput,
      [
        "tasks:",
        "  - id: T-plan",
        "    title: Plan command task",
        "    type: coding",
        "    status: draft",
        "    agent: executor",
        "    dependencies: []",
        "    write_scope:",
        "      - src/plan/**",
        "    acceptance:",
        "      - Plan command updates artifacts.",
        "    output:",
        "      - changed_files",
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        "plan",
        "--cwd",
        root,
        "--prompt",
        "Create planning artifacts.",
        "--spec-output",
        specOutput,
        "--todo-output",
        todoOutput,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Spec update:/);
    assert.match(result.stdout, /Todo update:/);
    assert.match(readFileSync(join(root, ".ai", "spec.md"), "utf8"), /Planned Spec/);
    assert.match(
      readFileSync(join(root, ".ai", "workflow-todo.yaml"), "utf8"),
      /T-plan/,
    );
    assert.equal(
      readFileSync(join(root, ".ai", "runs", "planning", "spec-model-output.md"), "utf8"),
      "# Planned Spec\n\nDiscussed capability.\n",
    );
    assert.equal(
      readFileSync(join(root, ".ai", "runs", "planning", "todo-model-output.yaml"), "utf8"),
      readFileSync(todoOutput, "utf8"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI iterations command displays the iteration list", () => {
  const cliPath = fileURLToPath(new URL("../../src/tui/cli.js", import.meta.url));
  const root = mkdtempSync(join(tmpdir(), "tui-iterations-list-"));
  try {
    mkdirSync(join(root, ".ai", "iterations"), { recursive: true });
    writeFileSync(
      join(root, ".ai", "iterations", "0001-foundation.md"),
      "# Iteration 0001: Foundation\n",
      "utf8",
    );
    writeFileSync(
      join(root, ".ai", "iterations", "0002-round-two.md"),
      "# Iteration 0002: Round Two\n",
      "utf8",
    );

    const result = spawnSync(process.execPath, [cliPath, "iterations", "--cwd", root], {
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Iterations:/);
    assert.match(result.stdout, /0001 Foundation/);
    assert.match(result.stdout, /0002 Round Two/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI iteration-draft command creates the next iteration from review context", () => {
  const cliPath = fileURLToPath(new URL("../../src/tui/cli.js", import.meta.url));
  const root = mkdtempSync(join(tmpdir(), "tui-iteration-draft-"));
  try {
    mkdirSync(join(root, ".ai", "iterations"), { recursive: true });
    writeFileSync(
      join(root, ".ai", "iterations", "0001-foundation.md"),
      "# Iteration 0001: Foundation\n",
      "utf8",
    );
    writeFileSync(
      join(root, ".ai", "iterations", "template.md"),
      [
        "# Iteration NNNN: Title",
        "",
        "## Trigger",
        "",
        "{{trigger}}",
        "",
        "## Review Summary",
        "",
        "{{reviewSummary}}",
      ].join("\n"),
      "utf8",
    );
    const reviewPath = join(root, "review.md");
    writeFileSync(reviewPath, "Reviewer approved dashboard work.\n", "utf8");

    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        "iteration-draft",
        "--cwd",
        root,
        "--title",
        "Post Review Memory",
        "--review",
        reviewPath,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /created: \.ai\/iterations\/0002-post-review-memory\.md/);
    const createdFiles = readdirSync(join(root, ".ai", "iterations"));
    assert.ok(createdFiles.includes("0002-post-review-memory.md"));
    assert.match(
      readFileSync(join(root, ".ai", "iterations", "0002-post-review-memory.md"), "utf8"),
      /Reviewer approved dashboard work/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI todo, next, queue, history, and run commands expose Phase 1 controls", () => {
  const cliPath = fileURLToPath(new URL("../../src/tui/cli.js", import.meta.url));
  const root = mkdtempSync(join(tmpdir(), "tui-phase-controls-"));
  try {
    mkdirSync(join(root, ".ai"), { recursive: true });
    writeFileSync(
      join(root, ".ai", "workflow-todo.yaml"),
      [
        "project: phase-controls",
        "version: 1",
        "goal: exercise tui commands",
        "tasks:",
        "  - id: T-ready",
        "    title: Ready command task",
        "    type: coding",
        "    status: ready",
        "    agent: executor",
        "    dependencies: []",
        "    write_scope:",
        "      - src/ready/**",
        "    acceptance:",
        "      - Can be dispatched.",
        "    output:",
        "      - changed_files",
      ].join("\n"),
      "utf8",
    );

    const todo = spawnSync(process.execPath, [cliPath, "todo", "--cwd", root], {
      encoding: "utf8",
    });
    assert.equal(todo.status, 0, todo.stderr);
    assert.match(todo.stdout, /T-ready \[ready\] Ready command task/);

    const next = spawnSync(process.execPath, [cliPath, "next", "--cwd", root], {
      encoding: "utf8",
    });
    assert.equal(next.status, 0, next.stderr);
    assert.match(next.stdout, /T-ready priority=/);
    assert.match(readFileSync(join(root, ".ai", "task-queue.yaml"), "utf8"), /T-ready/);

    const run = spawnSync(process.execPath, [cliPath, "run", "T-ready", "--cwd", root], {
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /run: prepared T-ready/);
    assert.match(readFileSync(join(root, ".ai", "run-history.yaml"), "utf8"), /Prepared executor/);

    const history = spawnSync(process.execPath, [cliPath, "history", "--cwd", root], {
      encoding: "utf8",
    });
    assert.equal(history.status, 0, history.stderr);
    assert.match(history.stdout, /History:/);
    assert.match(history.stdout, /run T-ready prepared/);

    const queue = spawnSync(process.execPath, [cliPath, "queue", "--cwd", root], {
      encoding: "utf8",
    });
    assert.equal(queue.status, 0, queue.stderr);
    assert.match(queue.stdout, /Queue:/);
    assert.match(queue.stdout, /T-ready pending/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI projects command manages a registry without touching project state", () => {
  const cliPath = fileURLToPath(new URL("../../src/tui/cli.js", import.meta.url));
  const root = mkdtempSync(join(tmpdir(), "tui-projects-"));
  try {
    const registry = join(root, "projects.yaml");
    const add = spawnSync(
      process.execPath,
      [
        cliPath,
        "projects",
        "add",
        "--registry",
        registry,
        "--id",
        "alpha",
        "--name",
        "Alpha",
        "--path",
        root,
      ],
      { encoding: "utf8" },
    );
    assert.equal(add.status, 0, add.stderr);
    assert.match(add.stdout, /project added: alpha/);

    const list = spawnSync(
      process.execPath,
      [cliPath, "projects", "list", "--registry", registry],
      { encoding: "utf8" },
    );
    assert.equal(list.status, 0, list.stderr);
    assert.match(list.stdout, /\* alpha Alpha/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI run can execute an external executor command", () => {
  const cliPath = fileURLToPath(new URL("../../src/tui/cli.js", import.meta.url));
  const root = mkdtempSync(join(tmpdir(), "tui-run-executor-"));
  try {
    mkdirSync(join(root, ".ai"), { recursive: true });
    writeFileSync(join(root, ".ai", "spec.md"), "# Executor CLI Spec\n", "utf8");
    writeFileSync(
      join(root, ".ai", "workflow-todo.yaml"),
      [
        "project: executor-cli",
        "version: 1",
        "goal: run executor commands",
        "tasks:",
        "  - id: T-exec",
        "    title: Execute command",
        "    type: coding",
        "    status: ready",
        "    agent: executor",
        "    dependencies: []",
        "    write_scope:",
        "      - src/executor/**",
        "    acceptance:",
        "      - Command runs.",
        "    output:",
        "      - changed_files",
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        "run",
        "T-exec",
        "--cwd",
        root,
        "--executor-command",
        process.execPath,
        "--executor-arg",
        "-e",
        "--executor-arg",
        "console.log('executor cli ok')",
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /run: executed T-exec/);
    assert.match(result.stdout, /phase: review/);
    assert.match(
      readFileSync(join(root, ".ai", "runs", "T-exec", "stdout.log"), "utf8"),
      /executor cli ok/,
    );
    assert.match(readFileSync(join(root, ".ai", "run-history.yaml"), "utf8"), /review/);
    assert.match(readFileSync(join(root, ".ai", "task-queue.yaml"), "utf8"), /review/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
