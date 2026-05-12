import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";

import YAML from "yaml";

import type { RoutesConfig, TaskStatus, TodoTask, WorkflowTodo } from "../shared/types.js";

const READY_RUNNING_STATUSES = new Set<TaskStatus>(["ready", "running"]);

export const allowedTaskTransitions: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  idea: ["draft"],
  draft: ["ready", "blocked"],
  ready: ["running", "blocked"],
  running: ["review", "blocked"],
  blocked: [],
  review: ["fix_needed", "done"],
  fix_needed: ["ready"],
  done: [],
};

export interface WriteScopeConflict {
  taskId: string;
  otherTaskId: string;
  scope: string;
  otherScope: string;
}

export class InvalidTaskTransitionError extends Error {
  constructor(taskId: string, from: TaskStatus, to: TaskStatus) {
    super(`Invalid task transition for ${taskId}: ${from} -> ${to}`);
    this.name = "InvalidTaskTransitionError";
  }
}

export class TaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = "TaskNotFoundError";
  }
}

export class WriteScopeConflictError extends Error {
  readonly conflict: WriteScopeConflict;

  constructor(conflict: WriteScopeConflict) {
    super(
      `Write scope conflict between ${conflict.taskId} (${conflict.scope}) and ` +
        `${conflict.otherTaskId} (${conflict.otherScope})`,
    );
    this.name = "WriteScopeConflictError";
    this.conflict = conflict;
  }
}

export class StateManager {
  readonly rootDir: string;

  constructor(rootDir = process.cwd()) {
    this.rootDir = rootDir;
  }

  loadSpec(): Promise<string> {
    return this.loadText(".ai/spec.md");
  }

  saveSpec(content: string): Promise<void> {
    return this.saveText(".ai/spec.md", content);
  }

  loadDecisions(): Promise<string> {
    return this.loadText(".ai/decisions.md");
  }

  saveDecisions(content: string): Promise<void> {
    return this.saveText(".ai/decisions.md", content);
  }

  async loadRoutes(): Promise<RoutesConfig> {
    return YAML.parse(await this.loadText(".ai/routes.yaml")) as RoutesConfig;
  }

  saveRoutes(routes: RoutesConfig): Promise<void> {
    return this.saveYaml(".ai/routes.yaml", routes);
  }

  async loadTodo(): Promise<WorkflowTodo> {
    return YAML.parse(await this.loadText(".ai/workflow-todo.yaml")) as WorkflowTodo;
  }

  saveTodo(todo: WorkflowTodo): Promise<void> {
    return this.saveYaml(".ai/workflow-todo.yaml", todo);
  }

  loadRunArtifact(taskId: string, artifactName: string): Promise<string> {
    return this.loadText(this.runArtifactPath(taskId, artifactName));
  }

  saveRunArtifact(taskId: string, artifactName: string, content: string): Promise<void> {
    return this.saveText(this.runArtifactPath(taskId, artifactName), content);
  }

  transitionTask(todo: WorkflowTodo, taskId: string, nextStatus: TaskStatus): WorkflowTodo {
    const taskIndex = todo.tasks.findIndex((task) => task.id === taskId);
    if (taskIndex === -1) {
      throw new TaskNotFoundError(taskId);
    }

    const task = todo.tasks[taskIndex];
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }

    if (!isValidTaskTransition(task.status, nextStatus)) {
      throw new InvalidTaskTransitionError(taskId, task.status, nextStatus);
    }

    const updatedTask: TodoTask = { ...task, status: nextStatus };
    if (READY_RUNNING_STATUSES.has(nextStatus)) {
      const conflict = findWriteScopeConflict(updatedTask, todo.tasks);
      if (conflict) {
        throw new WriteScopeConflictError(conflict);
      }
    }

    return {
      ...todo,
      tasks: todo.tasks.map((current, index) => (index === taskIndex ? updatedTask : { ...current })),
    };
  }

  validateReadyRunningWriteScopes(todo: WorkflowTodo): void {
    for (const task of todo.tasks) {
      if (!READY_RUNNING_STATUSES.has(task.status)) {
        continue;
      }

      const conflict = findWriteScopeConflict(task, todo.tasks);
      if (conflict) {
        throw new WriteScopeConflictError(conflict);
      }
    }
  }

  private async loadText(relativePath: string): Promise<string> {
    return readFile(this.resolveProjectPath(relativePath), "utf8");
  }

  private async saveText(relativePath: string, content: string): Promise<void> {
    const filePath = this.resolveProjectPath(relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }

  private saveYaml(relativePath: string, value: unknown): Promise<void> {
    return this.saveText(relativePath, YAML.stringify(value));
  }

  private runArtifactPath(taskId: string, artifactName: string): string {
    assertSafeRelativeSegment(taskId, "task id");
    assertSafeRelativeSegment(artifactName, "artifact name");
    return join(".ai", "runs", taskId, artifactName);
  }

  private resolveProjectPath(relativePath: string): string {
    if (isAbsolute(relativePath)) {
      throw new Error(`Project paths must be relative: ${relativePath}`);
    }

    const normalizedPath = normalize(relativePath);
    if (normalizedPath === ".." || normalizedPath.startsWith(`..${sep}`)) {
      throw new Error(`Project path escapes root: ${relativePath}`);
    }

    return join(this.rootDir, normalizedPath);
  }
}

export function isValidTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  return allowedTaskTransitions[from].includes(to);
}

export function findWriteScopeConflict(
  task: TodoTask,
  otherTasks: readonly TodoTask[],
): WriteScopeConflict | undefined {
  for (const otherTask of otherTasks) {
    if (otherTask.id === task.id || !READY_RUNNING_STATUSES.has(otherTask.status)) {
      continue;
    }

    for (const scope of task.write_scope) {
      for (const otherScope of otherTask.write_scope) {
        if (writeScopesOverlap(scope, otherScope)) {
          return {
            taskId: task.id,
            otherTaskId: otherTask.id,
            scope,
            otherScope,
          };
        }
      }
    }
  }

  return undefined;
}

export function writeScopesOverlap(left: string, right: string): boolean {
  const leftScope = parseWriteScope(left);
  const rightScope = parseWriteScope(right);

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

interface ParsedWriteScope {
  value: string;
  base: string;
  hasWildcard: boolean;
}

function parseWriteScope(scope: string): ParsedWriteScope {
  const value = normalizeWriteScope(scope);
  const wildcardIndex = value.search(/[*?[]/);
  if (wildcardIndex === -1) {
    return { value, base: value, hasWildcard: false };
  }

  const prefix = value.slice(0, wildcardIndex);
  const lastSlash = prefix.lastIndexOf("/");
  const base = lastSlash === -1 ? "" : prefix.slice(0, lastSlash);
  return { value, base, hasWildcard: true };
}

function normalizeWriteScope(scope: string): string {
  let value = scope.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (value.startsWith("./")) {
    value = value.slice(2);
  }
  if (value.length > 1 && value.endsWith("/")) {
    value = value.slice(0, -1);
  }
  return value;
}

function isSameOrChild(path: string, parent: string): boolean {
  return parent === "" || path === parent || path.startsWith(`${parent}/`);
}

function assertSafeRelativeSegment(value: string, label: string): void {
  if (value.length === 0 || isAbsolute(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  const normalizedValue = normalize(value);
  if (
    normalizedValue === "." ||
    normalizedValue === ".." ||
    normalizedValue.startsWith(`..${sep}`) ||
    normalizedValue.includes(`${sep}..${sep}`) ||
    normalizedValue.endsWith(`${sep}..`)
  ) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}
