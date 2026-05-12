import YAML from "yaml";

import {
  isValidTaskTransition,
  type StateManager,
} from "../../state/index.js";
import type { TaskStatus, TodoTask, WorkflowTodo } from "../../shared/types.js";
import {
  type CommandResult,
  saveExactModelOutputArtifact,
  summarizeCommandResult,
} from "../spec/artifacts.js";

export interface PlanCommandInput {
  state: StateManager;
  discussionPrompt: string;
  modelOutput: string;
  artifactTaskId?: string;
  artifactName?: string;
}

export type PlanCommandResult = CommandResult & {
  todoPath: ".ai/workflow-todo.yaml";
  added: number;
  updated: number;
  preserved: number;
};

const VALID_STATUSES = new Set<TaskStatus>([
  "idea",
  "draft",
  "ready",
  "running",
  "blocked",
  "review",
  "fix_needed",
  "done",
]);

export async function generateOrUpdateTodoFromDiscussion(
  input: PlanCommandInput,
): Promise<PlanCommandResult> {
  const artifact = await saveExactModelOutputArtifact({
    state: input.state,
    taskId: input.artifactTaskId ?? "planning",
    artifactName: input.artifactName ?? "todo-model-output.yaml",
    modelOutput: input.modelOutput,
  });

  const existingTodo = await loadOptionalTodo(input.state);
  const baseTodo = existingTodo ?? createEmptyTodo(input.discussionPrompt);
  const incomingTasks = parseTodoTasks(input.modelOutput);
  const merge = mergeTasks(baseTodo.tasks, incomingTasks);
  const nextTodo: WorkflowTodo = {
    ...baseTodo,
    tasks: merge.tasks,
  };
  validateTodoUpdate(baseTodo, nextTodo);

  await input.state.saveTodo(nextTodo);

  return {
    todoPath: ".ai/workflow-todo.yaml",
    added: merge.added,
    updated: merge.updated,
    preserved: merge.preserved,
    artifact,
    summary: summarizeCommandResult({
      action: "Generated or updated todo list from discussion prompt.",
      artifact,
      modelOutput: input.modelOutput,
      details: [
        `Todo path: .ai/workflow-todo.yaml`,
        `Tasks added ${merge.added}, updated ${merge.updated}, preserved ${merge.preserved}.`,
      ],
    }),
  };
}

function validateTodoUpdate(previousTodo: WorkflowTodo, nextTodo: WorkflowTodo): void {
  for (const nextTask of nextTodo.tasks) {
    validateDispatchableTask(nextTask);

    const previousTask = previousTodo.tasks.find((task) => task.id === nextTask.id);
    if (
      previousTask &&
      previousTask.status !== nextTask.status &&
      !isValidTaskTransition(previousTask.status, nextTask.status)
    ) {
      throw new Error(
        `Invalid task transition for ${nextTask.id}: ${previousTask.status} -> ${nextTask.status}`,
      );
    }
  }

  validateReadyRunningWriteScopes(nextTodo.tasks);
}

function validateDispatchableTask(task: TodoTask): void {
  if (task.status !== "ready" && task.status !== "running") {
    return;
  }

  if (task.acceptance.length === 0 || task.acceptance.every((item) => item.trim().length === 0)) {
    throw new Error(`Task ${task.id} cannot be ${task.status} without acceptance criteria.`);
  }

  if (task.write_scope.length === 0 || task.write_scope.every((item) => item.trim().length === 0)) {
    throw new Error(`Task ${task.id} cannot be ${task.status} without bounded write_scope.`);
  }
}

function validateReadyRunningWriteScopes(tasks: readonly TodoTask[]): void {
  const activeTasks = tasks.filter((task) => task.status === "ready" || task.status === "running");

  for (let leftIndex = 0; leftIndex < activeTasks.length; leftIndex += 1) {
    const left = activeTasks[leftIndex];
    if (!left) {
      continue;
    }

    for (const right of activeTasks.slice(leftIndex + 1)) {
      for (const leftScope of left.write_scope) {
        for (const rightScope of right.write_scope) {
          if (writeScopesOverlap(leftScope, rightScope)) {
            throw new Error(
              `Write scope conflict between ${left.id} (${leftScope}) and ${right.id} (${rightScope})`,
            );
          }
        }
      }
    }
  }
}

function writeScopesOverlap(left: string, right: string): boolean {
  const leftScope = parseScope(left);
  const rightScope = parseScope(right);

  if (leftScope.value === rightScope.value) {
    return true;
  }

  if (leftScope.hasWildcard || rightScope.hasWildcard) {
    return (
      isSameOrChild(leftScope.base, rightScope.base) ||
      isSameOrChild(rightScope.base, leftScope.base)
    );
  }

  return false;
}

function parseScope(scope: string): { value: string; base: string; hasWildcard: boolean } {
  const value = scope.replace(/\\/gu, "/").replace(/\/+/gu, "/").replace(/^\.\//u, "");
  const wildcardIndex = value.search(/[*?[]/);
  if (wildcardIndex === -1) {
    return { value, base: value, hasWildcard: false };
  }

  const prefix = value.slice(0, wildcardIndex);
  const slashIndex = prefix.lastIndexOf("/");
  const base = slashIndex === -1 ? "" : prefix.slice(0, slashIndex);
  return { value, base, hasWildcard: true };
}

function isSameOrChild(candidate: string, parent: string): boolean {
  if (parent === "") {
    return true;
  }

  return candidate === parent || candidate.startsWith(`${parent}/`);
}

function parseTodoTasks(modelOutput: string): TodoTask[] {
  const parsed = YAML.parse(extractYamlSource(modelOutput)) as unknown;
  const rawTasks = selectRawTasks(parsed);
  return rawTasks.map(normalizeTask);
}

function extractYamlSource(modelOutput: string): string {
  const fenced = modelOutput.match(/```(?:ya?ml)?\s*([\s\S]*?)```/iu);
  return fenced?.[1] ?? modelOutput;
}

function selectRawTasks(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (isRecord(parsed) && Array.isArray(parsed.tasks)) {
    return parsed.tasks;
  }

  if (isRecord(parsed) && isRecord(parsed.todo) && Array.isArray(parsed.todo.tasks)) {
    return parsed.todo.tasks;
  }

  throw new Error("Todo model output must be YAML containing a tasks array.");
}

function normalizeTask(rawTask: unknown): TodoTask {
  if (!isRecord(rawTask)) {
    throw new Error("Todo task must be an object.");
  }

  const status = stringValue(rawTask.status, "status");
  if (!VALID_STATUSES.has(status as TaskStatus)) {
    throw new Error(`Invalid todo task status: ${status}`);
  }

  return {
    id: stringValue(rawTask.id, "id"),
    title: stringValue(rawTask.title, "title"),
    type: stringValue(rawTask.type, "type"),
    status: status as TaskStatus,
    agent: stringValue(rawTask.agent, "agent"),
    dependencies: stringArrayValue(rawTask.dependencies, "dependencies"),
    write_scope: stringArrayValue(rawTask.write_scope, "write_scope"),
    acceptance: stringArrayValue(rawTask.acceptance, "acceptance"),
    output: stringArrayValue(rawTask.output, "output"),
    ...(typeof rawTask.risk === "string" ? { risk: rawTask.risk } : {}),
    ...(typeof rawTask.parallel_group === "string"
      ? { parallel_group: rawTask.parallel_group }
      : {}),
    ...(Array.isArray(rawTask.suggested_stack)
      ? { suggested_stack: stringArrayValue(rawTask.suggested_stack, "suggested_stack") }
      : {}),
  };
}

function mergeTasks(
  existingTasks: readonly TodoTask[],
  incomingTasks: readonly TodoTask[],
): { tasks: TodoTask[]; added: number; updated: number; preserved: number } {
  const incomingById = new Map(incomingTasks.map((task) => [task.id, task]));
  let updated = 0;
  let preserved = 0;

  const tasks = existingTasks.map((task) => {
    const incoming = incomingById.get(task.id);
    if (!incoming) {
      preserved += 1;
      return { ...task };
    }

    updated += 1;
    incomingById.delete(task.id);
    return { ...incoming };
  });

  const addedTasks = [...incomingById.values()].map((task) => ({ ...task }));
  return {
    tasks: [...tasks, ...addedTasks],
    added: addedTasks.length,
    updated,
    preserved,
  };
}

async function loadOptionalTodo(state: StateManager): Promise<WorkflowTodo | undefined> {
  try {
    return await state.loadTodo();
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

function createEmptyTodo(discussionPrompt: string): WorkflowTodo {
  return {
    project: "AI Workbench",
    version: 1,
    goal: firstNonEmptyLine(discussionPrompt) ?? "Plan main-thread workflow",
    tasks: [],
  };
}

function firstNonEmptyLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Todo task ${field} must be a non-empty string.`);
  }

  return value;
}

function stringArrayValue(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Todo task ${field} must be a string array.`);
  }

  return [...value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
