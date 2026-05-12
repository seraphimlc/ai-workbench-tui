#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { generateOrUpdateTodoFromDiscussion } from "../commands/plan/index.js";
import { createOrUpdateSpecFromDiscussion } from "../commands/spec/index.js";
import { appendRunHistoryEntry, createEmptyRunHistory, renderRunHistory } from "../history/index.js";
import {
  loadProjectRegistry,
  registerProject,
  renderProjectRegistry,
  resolveProjectRoot,
  saveProjectRegistry,
  selectProject,
} from "../projects/index.js";
import { createEmptyTaskQueue, renderTaskQueue, syncQueueFromTodo } from "../queue/index.js";
import type { RunHistory, TaskQueue } from "../shared/types.js";
import { StateManager } from "../state/index.js";
import {
  createTuiIterationDashboard,
  createDefaultTuiState,
  handleTuiCommand,
  renderTuiShell,
  type TuiCommandAction,
} from "./index.js";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const rootDir = await resolveRootDir(argv);
  const state = createDefaultTuiState(rootDir);
  state.iterationDashboard = await createTuiIterationDashboard(rootDir);

  if (argv.includes("--help") || argv.includes("-h")) {
    output.write(`${renderTuiShell(state)}\n\n`);
    output.write(
      [
        "Usage:",
        "  ai-workbench [--render-once]",
        "  ai-workbench status",
        "  ai-workbench todo",
        "  ai-workbench next",
        "  ai-workbench queue",
        "  ai-workbench history",
        "  ai-workbench projects [list|add|use]",
        "  ai-workbench plan",
        "  ai-workbench plan --prompt TEXT --spec-output FILE --todo-output FILE",
        "  ai-workbench iterations",
        "  ai-workbench iteration-draft --title TEXT --review FILE",
        "  ai-workbench run <task-id>",
        "  ai-workbench review <task-id>",
        "  ai-workbench quit",
        "",
      ].join("\n"),
    );
    return 0;
  }

  if (argv.includes("--render-once") || argv.length === 0) {
    output.write(`${renderTuiShell(state)}\n`);
    return 0;
  }

  if (argv[0] === "plan" && argv.length > 1) {
    try {
      const result = await runPlanCommand(argv.slice(1));
      output.write(`${renderTuiShell(await createDefaultStateWithIterations(rootDir))}\n\n${result}\n`);
      return 0;
    } catch (error) {
      output.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  if (argv[0] === "iterations") {
    try {
      output.write(`${renderTuiShell(state)}\n\n${await renderIterationsCommand(argv.slice(1))}\n`);
      return 0;
    } catch (error) {
      output.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  if (argv[0] === "iteration-draft") {
    try {
      output.write(`${renderTuiShell(state)}\n\n${await runIterationDraftCommand(argv.slice(1))}\n`);
      return 0;
    } catch (error) {
      output.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  if (argv[0] === "todo") {
    try {
      output.write(`${renderTuiShell(state)}\n\n${await renderTodoCommand(argv.slice(1))}\n`);
      return 0;
    } catch (error) {
      output.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  if (argv[0] === "next") {
    try {
      output.write(`${renderTuiShell(state)}\n\n${await runNextCommand(argv.slice(1))}\n`);
      return 0;
    } catch (error) {
      output.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  if (argv[0] === "queue") {
    try {
      output.write(`${renderTuiShell(state)}\n\n${await renderQueueCommand(argv.slice(1))}\n`);
      return 0;
    } catch (error) {
      output.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  if (argv[0] === "history") {
    try {
      output.write(`${renderTuiShell(state)}\n\n${await renderHistoryCommand(argv.slice(1))}\n`);
      return 0;
    } catch (error) {
      output.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  if (argv[0] === "projects") {
    try {
      output.write(`${renderTuiShell(state)}\n\n${await runProjectsCommand(argv.slice(1))}\n`);
      return 0;
    } catch (error) {
      output.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  if (argv[0] === "run" || argv[0] === "review") {
    try {
      const result = await prepareRunOrReviewCommand(argv);
      output.write(`${renderTuiShell(await createDefaultStateWithIterations(rootDir))}\n\n${result}\n`);
      return 0;
    } catch (error) {
      output.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  const action = handleTuiCommand(argv.join(" "));
  output.write(`${renderTuiShell(state)}\n\n${describeAction(action)}\n`);

  if (action.kind === "unknown") {
    return 1;
  }

  if (action.kind !== "quit" || !input.isTTY) {
    return 0;
  }

  const readline = createInterface({ input, output });
  try {
    for (;;) {
      const answer = await readline.question("ai-workbench> ");
      const nextAction = handleTuiCommand(answer);
      output.write(`${describeAction(nextAction)}\n`);
      if (nextAction.kind === "quit") {
        return 0;
      }
    }
  } finally {
    readline.close();
  }
}

async function runPlanCommand(argv: string[]): Promise<string> {
  const options = parsePlanOptions(argv);
  const state = new StateManager(options.cwd);
  const lines: string[] = [];

  if (!options.specOutputFile && !options.todoOutputFile) {
    throw new Error("plan requires --spec-output FILE and/or --todo-output FILE when a prompt is provided");
  }

  if (options.specOutputFile) {
    const specOutput = await readFile(options.specOutputFile, "utf8");
    const result = await createOrUpdateSpecFromDiscussion({
      state,
      discussionPrompt: options.prompt,
      modelOutput: specOutput,
      artifactTaskId: options.artifactTaskId,
      artifactName: "spec-model-output.md",
    });
    lines.push("Spec update:", ...result.summary.map((line) => `- ${line}`));
  }

  if (options.todoOutputFile) {
    const todoOutput = await readFile(options.todoOutputFile, "utf8");
    const result = await generateOrUpdateTodoFromDiscussion({
      state,
      discussionPrompt: options.prompt,
      modelOutput: todoOutput,
      artifactTaskId: options.artifactTaskId,
      artifactName: "todo-model-output.yaml",
    });
    lines.push("Todo update:", ...result.summary.map((line) => `- ${line}`));
  }

  return lines.join("\n");
}

async function createDefaultStateWithIterations(rootDir: string) {
  const state = createDefaultTuiState(rootDir);
  state.iterationDashboard = await createTuiIterationDashboard(rootDir);
  return state;
}

async function renderTodoCommand(argv: string[]): Promise<string> {
  const options = parseCwdOption(argv);
  const todo = await new StateManager(options.cwd).loadTodo();
  if (todo.tasks.length === 0) {
    return "Todo:\n- empty";
  }

  return [
    `Todo: ${todo.project}`,
    ...todo.tasks.map(
      (task) =>
        `- ${task.id} [${task.status}] ${task.title} (${task.type}, ${task.agent})`,
    ),
  ].join("\n");
}

async function runNextCommand(argv: string[]): Promise<string> {
  const options = parseCwdOption(argv);
  const state = new StateManager(options.cwd);
  const todo = await state.loadTodo();
  const queue = syncQueueFromTodo(await loadTaskQueueOrEmpty(state), todo, {
    projectId: todo.project,
  });
  await state.saveTaskQueue(queue);
  const next = queue.items.filter((item) => item.status === "pending").slice(0, 5);

  if (next.length === 0) {
    return "Next:\n- no dispatchable tasks";
  }

  return ["Next:", ...next.map((item) => `- ${item.task_id} priority=${item.priority}`)].join(
    "\n",
  );
}

async function renderQueueCommand(argv: string[]): Promise<string> {
  const options = parseCwdOption(argv);
  const state = new StateManager(options.cwd);
  return renderTaskQueue(await loadTaskQueueOrEmpty(state));
}

async function renderHistoryCommand(argv: string[]): Promise<string> {
  const options = parseCwdOption(argv);
  const state = new StateManager(options.cwd);
  return renderRunHistory(await loadRunHistoryOrEmpty(state));
}

async function prepareRunOrReviewCommand(argv: string[]): Promise<string> {
  const kind = argv[0] as "run" | "review";
  const taskId = argv[1];
  if (!taskId) {
    throw new Error(`${kind} requires <task-id>`);
  }

  const options = parseCwdOption(argv.slice(2));
  const state = new StateManager(options.cwd);
  const todo = await state.loadTodo();
  const task = todo.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const history = appendRunHistoryEntry(await loadRunHistoryOrEmpty(state), {
    kind,
    task_id: taskId,
    project_id: todo.project,
    status: "prepared",
    command: `ai-workbench ${kind} ${taskId}`,
    summary:
      kind === "run"
        ? `Prepared executor handoff for ${task.title}.`
        : `Prepared reviewer handoff for ${task.title}.`,
  });
  await state.saveRunHistory(history);

  return [
    `${kind}: prepared ${taskId}`,
    `task: ${task.title}`,
    `status: ${task.status}`,
    `history: .ai/run-history.yaml`,
  ].join("\n");
}

async function runProjectsCommand(argv: string[]): Promise<string> {
  const options = parseProjectOptions(argv);
  const registry = await loadProjectRegistry(options.registryPath);

  if (options.action === "add") {
    const updated = await registerProject(
      registry,
      {
        id: options.id,
        name: options.name,
        path: options.path,
      },
      { setCurrent: true },
    );
    await saveProjectRegistry(updated, options.registryPath);
    return `project added: ${options.id}\n${renderProjectRegistry(updated)}`;
  }

  if (options.action === "use") {
    const updated = selectProject(registry, options.id);
    await saveProjectRegistry(updated, options.registryPath);
    return `project selected: ${options.id}\n${renderProjectRegistry(updated)}`;
  }

  return renderProjectRegistry(registry);
}

async function renderIterationsCommand(argv: string[]): Promise<string> {
  const options = parseCwdOption(argv);
  const { listIterations } = await import("../iterations/index.js");
  const iterations = await listIterations(options.cwd);

  if (iterations.length === 0) {
    return "Iterations:\n- none";
  }

  return [
    "Iterations:",
    ...iterations.map(
      (iteration) =>
        `- ${iteration.paddedNumber} ${iteration.title} (${iteration.relativePath})`,
    ),
  ].join("\n");
}

async function runIterationDraftCommand(argv: string[]): Promise<string> {
  const options = parseIterationDraftOptions(argv);
  const { createNextIterationNote } = await import("../iterations/index.js");
  const reviewSummary = options.reviewFile
    ? (await readFile(options.reviewFile, "utf8")).trim()
    : "Review completed.";
  const note = await createNextIterationNote(options.cwd, {
    title: options.title,
    values: {
      trigger: "Created after review.",
      reviewSummary,
    },
  });

  return [`iteration draft created: ${note.relativePath}`, `created: ${note.relativePath}`].join(
    "\n",
  );
}

interface PlanCommandOptions {
  prompt: string;
  specOutputFile?: string;
  todoOutputFile?: string;
  artifactTaskId: string;
  cwd: string;
}

interface CwdOption {
  cwd: string;
}

interface ProjectCommandOptions {
  action: "list" | "add" | "use";
  registryPath?: string;
  id: string;
  name: string;
  path: string;
}

interface IterationDraftOptions extends CwdOption {
  title: string;
  reviewFile?: string;
}

function parsePlanOptions(argv: string[]): PlanCommandOptions {
  const options: PlanCommandOptions = {
    prompt: "",
    artifactTaskId: "planning",
    cwd: process.cwd(),
  };
  const promptParts: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case "--prompt":
        options.prompt = requireNextValue(argv, index, "--prompt");
        index += 1;
        break;
      case "--spec-output":
        options.specOutputFile = requireNextValue(argv, index, "--spec-output");
        index += 1;
        break;
      case "--todo-output":
        options.todoOutputFile = requireNextValue(argv, index, "--todo-output");
        index += 1;
        break;
      case "--artifact-task-id":
        options.artifactTaskId = requireNextValue(argv, index, "--artifact-task-id");
        index += 1;
        break;
      case "--cwd":
        options.cwd = requireNextValue(argv, index, "--cwd");
        index += 1;
        break;
      default:
        if (value?.startsWith("-")) {
          throw new Error(`Unknown plan option: ${value}`);
        }
        if (value) {
          promptParts.push(value);
        }
    }
  }

  if (!options.prompt) {
    options.prompt = promptParts.join(" ");
  }

  if (!options.prompt.trim()) {
    throw new Error("plan requires --prompt TEXT or trailing prompt text");
  }

  return options;
}

function parseCwdOption(argv: string[]): CwdOption {
  const options: CwdOption = {
    cwd: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case "--cwd":
        options.cwd = requireNextValue(argv, index, "--cwd");
        index += 1;
        break;
      default:
        if (value?.startsWith("-")) {
          throw new Error(`Unknown iterations option: ${value}`);
        }
    }
  }

  return options;
}

function parseProjectOptions(argv: string[]): ProjectCommandOptions {
  const options: ProjectCommandOptions = {
    action: "list",
    id: "",
    name: "",
    path: "",
  };
  const [action] = argv;
  let startIndex = 0;
  if (action === "list" || action === "add" || action === "use") {
    options.action = action;
    startIndex = 1;
  }

  for (let index = startIndex; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case "--registry":
        options.registryPath = requireNextValue(argv, index, "--registry");
        index += 1;
        break;
      case "--id":
        options.id = requireNextValue(argv, index, "--id");
        index += 1;
        break;
      case "--name":
        options.name = requireNextValue(argv, index, "--name");
        index += 1;
        break;
      case "--path":
        options.path = requireNextValue(argv, index, "--path");
        index += 1;
        break;
      default:
        if (value?.startsWith("-")) {
          throw new Error(`Unknown projects option: ${value}`);
        }
    }
  }

  if (options.action === "add") {
    if (!options.id || !options.name || !options.path) {
      throw new Error("projects add requires --id, --name, and --path");
    }
  }

  if (options.action === "use" && !options.id) {
    throw new Error("projects use requires --id");
  }

  return options;
}

function parseIterationDraftOptions(argv: string[]): IterationDraftOptions {
  const options: IterationDraftOptions = {
    cwd: process.cwd(),
    title: "",
  };
  const titleParts: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case "--cwd":
        options.cwd = requireNextValue(argv, index, "--cwd");
        index += 1;
        break;
      case "--title":
        options.title = requireNextValue(argv, index, "--title");
        index += 1;
        break;
      case "--review":
        options.reviewFile = requireNextValue(argv, index, "--review");
        index += 1;
        break;
      default:
        if (value?.startsWith("-")) {
          throw new Error(`Unknown iteration-draft option: ${value}`);
        }
        if (value) {
          titleParts.push(value);
        }
    }
  }

  if (!options.title) {
    options.title = titleParts.join(" ");
  }

  if (!options.title.trim()) {
    throw new Error("iteration-draft requires --title TEXT or trailing title text");
  }

  return options;
}

async function resolveRootDir(argv: string[]): Promise<string> {
  const cwd = readGlobalCwd(argv);
  if (cwd) {
    return cwd;
  }

  const projectId = readGlobalOption(argv, "--project");
  if (projectId) {
    const registry = await loadProjectRegistry(readGlobalOption(argv, "--registry"));
    const projectRoot = resolveProjectRoot(registry, projectId);
    if (!projectRoot) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return projectRoot;
  }

  return process.cwd();
}

function readGlobalCwd(argv: string[]): string | undefined {
  return readGlobalOption(argv, "--cwd");
}

function readGlobalOption(argv: string[], optionName: string): string | undefined {
  const index = argv.indexOf(optionName);
  if (index < 0) {
    return undefined;
  }

  return argv[index + 1];
}

async function loadTaskQueueOrEmpty(state: StateManager): Promise<TaskQueue> {
  try {
    return await state.loadTaskQueue();
  } catch (error) {
    if (isMissingFile(error)) {
      return createEmptyTaskQueue();
    }
    throw error;
  }
}

async function loadRunHistoryOrEmpty(state: StateManager): Promise<RunHistory> {
  try {
    return await state.loadRunHistory();
  } catch (error) {
    if (isMissingFile(error)) {
      return createEmptyRunHistory();
    }
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function requireNextValue(argv: string[], index: number, optionName: string): string {
  const next = argv[index + 1];
  if (!next) {
    throw new Error(`${optionName} requires a value`);
  }

  return next;
}

function describeAction(action: TuiCommandAction): string {
  switch (action.kind) {
    case "status":
      return "status: workflow status view selected";
    case "todo":
      return "todo: task list view selected";
    case "next":
      return "next: dispatchable task view selected";
    case "plan":
      return "plan: planning context view selected";
    case "run":
      return `run: task ${action.taskId} selected`;
    case "review":
      return `review: task ${action.taskId} selected`;
    case "queue":
      return "queue: persisted task queue selected";
    case "history":
      return "history: run history selected";
    case "projects":
      return "projects: project registry selected";
    case "iterations":
      return "iterations: iteration list selected";
    case "iteration-draft":
      return `iteration-draft: ${action.title}`;
    case "quit":
      return "quit: exiting";
    case "unknown":
      return `unknown command: ${action.input}`;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => {
    process.exitCode = code;
  });
}
