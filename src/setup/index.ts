import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import YAML from "yaml";

import { createDefaultAlignmentDocument } from "../alignment/index.js";
import { StateManager } from "../state/index.js";
import { validateExecutorProfiles } from "../worker/index.js";

export interface InitWorkbenchOptions {
  projectName?: string;
  force?: boolean;
}

export interface InitWorkbenchResult {
  created: string[];
  skipped: string[];
  overwritten: string[];
}

export type DoctorCheckStatus = "pass" | "fail";

export interface DoctorCheck {
  name: string;
  status: DoctorCheckStatus;
  message: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

const REQUIRED_AI_FILES = [
  ".ai/spec.md",
  ".ai/workflow-todo.yaml",
  ".ai/alignment.md",
  ".ai/executor-profiles.yaml",
];

export async function initWorkbenchProject(
  rootDir = process.cwd(),
  options: InitWorkbenchOptions = {},
): Promise<InitWorkbenchResult> {
  const projectName = options.projectName ?? (basename(rootDir) || "AI Workbench Project");
  const templates = new Map<string, string>([
    [".ai/spec.md", specTemplate(projectName)],
    [".ai/workflow-todo.yaml", todoTemplate(projectName)],
    [".ai/alignment.md", createDefaultAlignmentDocument({ goal: `Keep ${projectName} aligned.` })],
    [".ai/executor-profiles.yaml", executorProfilesTemplate()],
  ]);
  const result: InitWorkbenchResult = {
    created: [],
    skipped: [],
    overwritten: [],
  };

  await mkdir(join(rootDir, ".ai"), { recursive: true });

  for (const [relativePath, content] of templates) {
    const fullPath = join(rootDir, relativePath);
    const exists = await fileExists(fullPath);
    if (exists && !options.force) {
      result.skipped.push(relativePath);
      continue;
    }

    await writeFile(fullPath, content, "utf8");
    if (exists) {
      result.overwritten.push(relativePath);
    } else {
      result.created.push(relativePath);
    }
  }

  return result;
}

export async function doctorWorkbenchProject(rootDir = process.cwd()): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  for (const relativePath of REQUIRED_AI_FILES) {
    checks.push(await requiredFileCheck(rootDir, relativePath));
  }

  checks.push(nodeVersionCheck());
  checks.push(await workflowTodoCheck(rootDir));
  checks.push(await executorProfilesCheck(rootDir));

  return {
    ok: checks.every((check) => check.status === "pass"),
    checks,
  };
}

export function renderInitResult(result: InitWorkbenchResult): string {
  const action =
    result.created.length > 0
      ? "created"
      : result.overwritten.length > 0
        ? "overwritten"
        : "unchanged";
  return [
    `init: ${action}`,
    ...result.created.map((file) => `- created ${file}`),
    ...result.overwritten.map((file) => `- overwritten ${file}`),
    ...result.skipped.map((file) => `- skipped ${file}`),
  ].join("\n");
}

export function renderDoctorReport(report: DoctorReport): string {
  return [
    `Doctor: ${report.ok ? "pass" : "fail"}`,
    ...report.checks.map(
      (check) => `- [${check.status}] ${check.name}: ${check.message}`,
    ),
  ].join("\n");
}

async function requiredFileCheck(rootDir: string, relativePath: string): Promise<DoctorCheck> {
  return {
    name: relativePath,
    ...(await fileExists(join(rootDir, relativePath))
      ? { status: "pass" as const, message: "found" }
      : { status: "fail" as const, message: `missing required file: ${relativePath}` }),
  };
}

function nodeVersionCheck(): DoctorCheck {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (major >= 18) {
    return {
      name: "node",
      status: "pass",
      message: `Node ${process.versions.node}`,
    };
  }

  return {
    name: "node",
    status: "fail",
    message: `Node 18 or newer required; found ${process.versions.node}`,
  };
}

async function workflowTodoCheck(rootDir: string): Promise<DoctorCheck> {
  try {
    const todo = await new StateManager(rootDir).loadTodo();
    if (!Array.isArray(todo.tasks)) {
      throw new Error("tasks must be an array");
    }
    return {
      name: "workflow-todo",
      status: "pass",
      message: `${todo.tasks.length} task(s)`,
    };
  } catch (error) {
    return {
      name: "workflow-todo",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function executorProfilesCheck(rootDir: string): Promise<DoctorCheck> {
  const result = await validateExecutorProfiles(new StateManager(rootDir));
  if (result.ok) {
    return {
      name: "executor-profiles",
      status: "pass",
      message: `${result.profiles.length} profile(s)`,
    };
  }

  return {
    name: "executor-profiles",
    status: "fail",
    message: `executor profiles invalid: ${result.errors.join("; ")}`,
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function specTemplate(projectName: string): string {
  return [
    `# ${projectName} Spec`,
    "",
    "## Goal",
    "",
    "Describe what this project should accomplish.",
    "",
    "## Model Integration",
    "",
    "Reasoning model output should be saved to files and consumed by `ai-workbench plan`.",
    "Execution model commands should be configured in `.ai/executor-profiles.yaml`.",
    "",
  ].join("\n");
}

function todoTemplate(projectName: string): string {
  return YAML.stringify({
    project: slugify(projectName),
    version: 1,
    goal: `Plan and execute work for ${projectName}.`,
    tasks: [],
  });
}

function executorProfilesTemplate(): string {
  return [
    "version: 1",
    "default_profile: echo-executor",
    "profiles:",
    "  echo-executor:",
    "    command: node",
    "    args:",
    "      - examples/executors/echo-executor.js",
    "    success_status: review",
    "    timeout_ms: 300000",
    "",
  ].join("\n");
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "_")
      .replace(/^_+|_+$/gu, "") || "ai_workbench_project"
  );
}
