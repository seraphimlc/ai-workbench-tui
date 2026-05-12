import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import YAML from "yaml";

import type { RunHistory, TaskQueue, WorkflowTodo } from "../shared/types.js";

export interface TuiShellState {
  discussion: string[] | string;
  specTodo: string[] | string;
  runs: string[] | string;
  logs: string[] | string;
  iterationDashboard?: TuiIterationDashboard;
}

export interface RenderTuiShellOptions {
  width?: number;
  paneHeight?: number;
}

export interface TuiIterationDashboard {
  latestTitle: string;
  currentCapability: string[];
  remainingGaps: string[];
  nextRecommendation: string[];
  iterations: string[];
}

export interface TuiCommand {
  name:
    | "status"
    | "todo"
    | "next"
    | "plan"
    | "run"
    | "review"
    | "queue"
    | "history"
    | "projects"
    | "iterations"
    | "iteration-draft"
    | "quit";
  shortcut: string;
  usage: string;
  description: string;
}

export type TuiCommandAction =
  | { kind: "status" }
  | { kind: "todo" }
  | { kind: "next" }
  | { kind: "plan" }
  | { kind: "run"; taskId: string }
  | { kind: "review"; taskId: string }
  | { kind: "queue" }
  | { kind: "history" }
  | { kind: "projects" }
  | { kind: "iterations" }
  | { kind: "iteration-draft"; title: string }
  | { kind: "quit" }
  | { kind: "unknown"; input: string };

const COMMANDS: TuiCommand[] = [
  {
    name: "status",
    shortcut: "s",
    usage: "status",
    description: "Show workflow and task status.",
  },
  {
    name: "todo",
    shortcut: "t",
    usage: "todo",
    description: "List todo status by lifecycle bucket.",
  },
  {
    name: "next",
    shortcut: "x",
    usage: "next",
    description: "Show the next dispatchable tasks.",
  },
  {
    name: "plan",
    shortcut: "p",
    usage: "plan",
    description: "Show the current planning context.",
  },
  {
    name: "run",
    shortcut: "r",
    usage: "run <task-id>",
    description: "Prepare a task run command.",
  },
  {
    name: "review",
    shortcut: "v",
    usage: "review <task-id>",
    description: "Prepare a task review command.",
  },
  {
    name: "queue",
    shortcut: "u",
    usage: "queue",
    description: "Show the persisted task queue.",
  },
  {
    name: "history",
    shortcut: "h",
    usage: "history",
    description: "Show recent run and review history.",
  },
  {
    name: "projects",
    shortcut: "j",
    usage: "projects",
    description: "Show registered projects.",
  },
  {
    name: "iterations",
    shortcut: "i",
    usage: "iterations",
    description: "Display iteration notes in order.",
  },
  {
    name: "iteration-draft",
    shortcut: "n",
    usage: "iteration-draft <title>",
    description: "Create the next iteration draft after review.",
  },
  {
    name: "quit",
    shortcut: "q",
    usage: "quit",
    description: "Exit the TUI.",
  },
];

export function getTuiCommands(): TuiCommand[] {
  return [...COMMANDS];
}

export function handleTuiCommand(input: string): TuiCommandAction {
  const normalized = input.trim().replace(/^:/, "");
  const match = normalized.match(/^(\S+)(?:\s+(.+))?$/u);
  const command = match?.[1] ?? "";
  const rest = match?.[2]?.trim() ?? "";

  switch (command.toLowerCase()) {
    case "s":
    case "status":
      return { kind: "status" };
    case "t":
    case "todo":
      return { kind: "todo" };
    case "x":
    case "next":
      return { kind: "next" };
    case "p":
    case "plan":
      return { kind: "plan" };
    case "r":
    case "run":
      return rest ? { kind: "run", taskId: rest } : { kind: "unknown", input };
    case "v":
    case "review":
      return rest ? { kind: "review", taskId: rest } : { kind: "unknown", input };
    case "u":
    case "queue":
      return { kind: "queue" };
    case "h":
    case "history":
      return { kind: "history" };
    case "j":
    case "projects":
      return { kind: "projects" };
    case "i":
    case "iterations":
      return { kind: "iterations" };
    case "n":
    case "draft":
    case "iteration-draft":
      return rest ? { kind: "iteration-draft", title: rest } : { kind: "unknown", input };
    case "q":
    case "quit":
    case "exit":
      return { kind: "quit" };
    default:
      return { kind: "unknown", input };
  }
}

export function renderTuiShell(
  state: TuiShellState,
  options: RenderTuiShellOptions = {},
): string {
  const width = Math.max(60, options.width ?? 100);
  const paneHeight = Math.max(5, options.paneHeight ?? 8);
  const gap = 2;
  const paneWidth = Math.floor((width - gap) / 2);

  const header = [
    fitLine("AI Workbench TUI", width),
    ...renderCommandHintLines(width),
    "",
  ];

  const top = combinePanes(
    renderPane("DISCUSSION", state.discussion, paneWidth, paneHeight),
    renderPane("SPEC / TODO", state.specTodo, paneWidth, paneHeight),
    gap,
  );
  const bottom = combinePanes(
    renderPane("RUNS / REVIEW", state.runs, paneWidth, paneHeight),
    renderPane("LOG", state.logs, paneWidth, paneHeight),
    gap,
  );
  const iterationDashboard = state.iterationDashboard
    ? ["", ...renderIterationDashboardPane(state.iterationDashboard, width, paneHeight + 3)]
    : [];

  return [...header, ...top, "", ...bottom, ...iterationDashboard].join("\n");
}

export async function createTuiIterationDashboard(
  rootDir = process.cwd(),
): Promise<TuiIterationDashboard> {
  const { listIterations, readLatestIteration } = await import("../iterations/index.js");
  const [iterations, latest] = await Promise.all([
    listIterations(rootDir).catch(() => []),
    readLatestIteration(rootDir).catch(() => undefined),
  ]);

  if (!latest) {
    return {
      latestTitle: "No iteration notes found.",
      currentCapability: ["Not documented."],
      remainingGaps: ["Not documented."],
      nextRecommendation: ["Not documented."],
      iterations: [],
    };
  }

  return {
    latestTitle: `Iteration ${latest.paddedNumber} - ${latest.title}`,
    currentCapability: sectionLines(latest.content, "Current Capability"),
    remainingGaps: sectionLines(latest.content, "Remaining Gaps"),
    nextRecommendation: sectionLines(latest.content, "Next Iteration Recommendation"),
    iterations: iterations.map(
      (iteration) => `${iteration.paddedNumber} ${iteration.title} (${iteration.relativePath})`,
    ),
  };
}

export function createDefaultTuiState(cwd = process.cwd()): TuiShellState {
  const todo = readYamlFile<WorkflowTodo>(cwd, ".ai/workflow-todo.yaml");
  const queue = readYamlFile<TaskQueue>(cwd, ".ai/task-queue.yaml");
  const history = readYamlFile<RunHistory>(cwd, ".ai/run-history.yaml");

  return {
    discussion: [
      "Main thread owns discussion, planning, decisions, and todo management.",
      "Executor agents perform bounded implementation tasks.",
      `Project: ${todo?.project ?? "unregistered"}`,
    ],
    specTodo: todo ? summarizeTodo(todo) : ["Workflow todo file not found."],
    runs: summarizeRuns(queue, history),
    logs: readSummary(cwd, ".ai/spec.md", ["Spec file not found."]),
  };
}

export function summarizeTodo(todo: WorkflowTodo): string[] {
  const counts = new Map<string, number>();
  for (const task of todo.tasks) {
    counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
  }

  const readyTasks = todo.tasks.filter((task) => task.status === "ready").slice(0, 3);
  return [
    `Goal: ${todo.goal}`,
    `Tasks: ${todo.tasks.length}`,
    ...["idea", "draft", "ready", "running", "review", "fix_needed", "blocked", "done"].map(
      (status) => `${status}: ${counts.get(status) ?? 0}`,
    ),
    ...readyTasks.map((task) => `ready: ${task.id} ${task.title}`),
  ];
}

export function summarizeRuns(queue?: TaskQueue, history?: RunHistory): string[] {
  const queueLines =
    queue && queue.items.length > 0
      ? queue.items.slice(0, 3).map((item) => `queue: ${item.task_id} ${item.status}`)
      : ["queue: empty"];
  const historyLines =
    history && history.entries.length > 0
      ? history.entries
          .slice(0, 3)
          .map((entry) => `history: ${entry.kind} ${entry.task_id ?? "-"} ${entry.status}`)
      : ["history: empty"];

  return [...queueLines, ...historyLines];
}

function renderCommandHintLines(width: number): string[] {
  const hints = COMMANDS.map((command) => `[${command.shortcut}] ${command.usage}`);
  const lines: string[] = [];
  let current = "Commands:";

  for (const hint of hints) {
    const next = current === "Commands:" ? `${current} ${hint}` : `${current} | ${hint}`;
    if (next.length <= width) {
      current = next;
      continue;
    }

    lines.push(fitLine(current, width));
    current = `          ${hint}`;
  }

  lines.push(fitLine(current, width));
  return lines;
}

function renderPane(
  title: string,
  content: string[] | string,
  width: number,
  height: number,
): string[] {
  const innerWidth = width - 4;
  const lines = toLines(content);
  const bodyHeight = height - 3;
  const body = lines.slice(0, bodyHeight);

  while (body.length < bodyHeight) {
    body.push("");
  }

  return [
    `+${"-".repeat(width - 2)}+`,
    `| ${fitLine(title, innerWidth)} |`,
    ...body.map((line) => `| ${fitLine(line, innerWidth)} |`),
    `+${"-".repeat(width - 2)}+`,
  ];
}

function renderIterationDashboardPane(
  dashboard: TuiIterationDashboard,
  width: number,
  height: number,
): string[] {
  const lines = [
    `Latest: ${dashboard.latestTitle}`,
    ...prefixedSection("Current Capability", dashboard.currentCapability),
    ...prefixedSection("Remaining Gaps", dashboard.remainingGaps),
    ...prefixedSection("Next Recommendation", dashboard.nextRecommendation),
  ];

  return renderPane("ITERATION DASHBOARD", lines, width, height);
}

function prefixedSection(title: string, values: string[]): string[] {
  const [first = "Not documented.", ...rest] = values.length > 0 ? values : ["Not documented."];
  return [`${title}: ${first}`, ...rest.map((line) => `  ${line}`)];
}

function combinePanes(left: string[], right: string[], gap: number): string[] {
  return left.map((line, index) => `${line}${" ".repeat(gap)}${right[index] ?? ""}`);
}

function toLines(content: string[] | string): string[] {
  if (Array.isArray(content)) {
    return content.flatMap((line) => line.split(/\r?\n/));
  }

  return content.split(/\r?\n/);
}

function sectionLines(content: string, sectionTitle: string): string[] {
  const lines = content.split(/\r?\n/);
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(sectionTitle)}\\s*$`, "iu");
  const start = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (start < 0) {
    return ["Not documented."];
  }

  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/u.test(line.trim())) {
      break;
    }

    const normalized = line.trim();
    if (normalized) {
      body.push(normalized);
    }
  }

  return body.length > 0 ? body : ["Not documented."];
}

function fitLine(value: string, width: number): string {
  if (value.length > width) {
    return `${value.slice(0, Math.max(0, width - 3))}...`;
  }

  return value.padEnd(width, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function readSummary(cwd: string, relativePath: string, fallback: string[]): string[] {
  const fullPath = join(cwd, relativePath);
  if (!existsSync(fullPath)) {
    return fallback;
  }

  const lines = readFileSync(fullPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.slice(0, 6);
}

function readYamlFile<T>(cwd: string, relativePath: string): T | undefined {
  const fullPath = join(cwd, relativePath);
  if (!existsSync(fullPath)) {
    return undefined;
  }

  return YAML.parse(readFileSync(fullPath, "utf8")) as T;
}
