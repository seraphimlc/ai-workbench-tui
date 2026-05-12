#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { generateOrUpdateTodoFromDiscussion } from "../commands/plan/index.js";
import { createOrUpdateSpecFromDiscussion } from "../commands/spec/index.js";
import { StateManager } from "../state/index.js";
import {
  createTuiIterationDashboard,
  createDefaultTuiState,
  handleTuiCommand,
  renderTuiShell,
  type TuiCommandAction,
} from "./index.js";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const rootDir = readGlobalCwd(argv) ?? process.cwd();
  const state = createDefaultTuiState(rootDir);
  state.iterationDashboard = await createTuiIterationDashboard(rootDir);

  if (argv.includes("--help") || argv.includes("-h")) {
    output.write(`${renderTuiShell(state)}\n\n`);
    output.write(
      [
        "Usage:",
        "  ai-workbench [--render-once]",
        "  ai-workbench status",
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

function readGlobalCwd(argv: string[]): string | undefined {
  const index = argv.indexOf("--cwd");
  if (index < 0) {
    return undefined;
  }

  return argv[index + 1];
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
    case "plan":
      return "plan: planning context view selected";
    case "run":
      return `run: task ${action.taskId} selected`;
    case "review":
      return `review: task ${action.taskId} selected`;
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
