import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { TaskStatus, TodoTask, WorkflowTodo } from "../shared/types.js";
import { StateManager } from "../state/index.js";

export interface ExecutorHandoffInput {
  spec: string;
  task: TodoTask;
  scope?: readonly string[];
  acceptance?: readonly string[];
  maxSpecCharacters?: number;
  extraInstructions?: readonly string[];
}

export interface ExecutorArtifactPaths {
  handoff: string;
  stdout: string;
  stderr: string;
  result: string;
}

export interface ExecutorProcessInput {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  runDir: string;
  handoffPrompt?: string;
  stdin?: string;
  maxLogCharacters?: number;
}

export interface ExecutorRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  artifactPaths: ExecutorArtifactPaths;
}

export interface RunningExecutorProcess {
  pid: number | undefined;
  child: ChildProcessWithoutNullStreams;
  artifactPaths: ExecutorArtifactPaths;
  startedAt: string;
  completed: Promise<ExecutorRunResult>;
}

export type RunStatusPhase = "running" | "review" | "done" | "blocked" | "fix_needed";

export interface RunStatusSummary {
  taskId: string;
  phase: RunStatusPhase;
  ok?: boolean;
  reason?: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt: string;
  durationMs?: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutPreview?: string;
  stderrPreview?: string;
  artifacts?: ExecutorArtifactPaths;
}

export interface RunStatusUpdate {
  todo: WorkflowTodo;
  summary: RunStatusSummary;
}

export interface MarkTaskRunStartedOptions {
  now?: string;
  stdout?: string;
  stderr?: string;
  maxPreviewCharacters?: number;
}

export interface ApplyExecutorRunResultOptions {
  successStatus?: "review" | "done";
  failureStatus?: "blocked" | "fix_needed";
  now?: string;
  maxPreviewCharacters?: number;
}

export interface BuildRunStatusSummaryInput {
  taskId: string;
  phase: RunStatusPhase;
  ok?: boolean;
  reason?: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt?: string;
  durationMs?: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
  maxPreviewCharacters?: number;
  artifacts?: ExecutorArtifactPaths;
}

export interface InterruptedRun {
  taskId: string;
  reason: string;
  endedAt?: string;
  stdout?: string;
  stderr?: string;
}

export interface InterruptedRunRecovery {
  todo: WorkflowTodo;
  summaries: RunStatusSummary[];
}

const DEFAULT_MAX_SPEC_CHARACTERS = 8_000;
const DEFAULT_MAX_LOG_CHARACTERS = 200_000;
const DEFAULT_MAX_PREVIEW_CHARACTERS = 2_000;

const SECRET_ASSIGNMENT_PATTERN =
  /\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|CREDENTIAL|PRIVATE[_-]?KEY|AUTH)[A-Z0-9_]*)\s*=\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s]+)/gi;
const SECRET_COLON_PATTERN =
  /\b([A-Z0-9_]*(?:api[_-]?key|token|secret|password|pass|pwd|credential|private[_-]?key|auth)[A-Z0-9_]*)\s*:\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s]+)/gi;

export function buildExecutorHandoffPrompt(input: ExecutorHandoffInput): string {
  const scope = input.scope ?? input.task.write_scope;
  const acceptance = input.acceptance ?? input.task.acceptance;
  const maxSpecCharacters = input.maxSpecCharacters ?? DEFAULT_MAX_SPEC_CHARACTERS;
  const specExcerpt = truncateText(input.spec, maxSpecCharacters);
  const truncatedNotice =
    input.spec.length > specExcerpt.length
      ? `\n\nSpec excerpt truncated to ${maxSpecCharacters} characters.`
      : "";

  const sections = [
    `# Executor handoff for ${input.task.id}`,
    `## Task\n${input.task.title}`,
    `## Type\n${input.task.type}`,
    `## Agent\n${input.task.agent}`,
    `## Dependencies\n${formatList(input.task.dependencies)}`,
    `## Write scope\n${formatList(scope)}`,
    `## Acceptance criteria\n${formatList(acceptance)}`,
    `## Output contract\n${formatList(input.task.output)}`,
    `## Boundaries\n${formatList([
      "Stay within the write scope listed above.",
      "Do not edit workflow state unless the task explicitly owns it.",
      "Write execution results to the requested run artifacts.",
      "Do not print secrets into logs or reports.",
    ])}`,
    `## Project spec excerpt\n${specExcerpt}${truncatedNotice}`,
  ];

  if (input.extraInstructions && input.extraInstructions.length > 0) {
    sections.push(`## Additional instructions\n${formatList(input.extraInstructions)}`);
  }

  return redactSecrets(`${sections.join("\n\n")}\n`);
}

export function redactSecrets(value: string): string {
  return value
    .replace(SECRET_ASSIGNMENT_PATTERN, (_match, key: string) => `${key}=[REDACTED]`)
    .replace(SECRET_COLON_PATTERN, (_match, key: string) => `${key}: [REDACTED]`);
}

export function markTaskRunStarted(
  todo: WorkflowTodo,
  taskId: string,
  options: MarkTaskRunStartedOptions = {},
): RunStatusUpdate {
  const task = findTask(todo, taskId);
  const updatedAt = options.now ?? new Date().toISOString();
  const nextTodo =
    task.status === "running" ? cloneTodo(todo) : transitionTodoStatus(todo, taskId, "running");
  const summary = buildRunStatusSummary({
    taskId,
    phase: "running",
    startedAt: updatedAt,
    updatedAt,
    stdout: options.stdout,
    stderr: options.stderr,
    maxPreviewCharacters: options.maxPreviewCharacters,
  });

  return {
    todo: annotateTaskWithRunSummary(nextTodo, summary),
    summary,
  };
}

export function applyExecutorRunResultToTodo(
  todo: WorkflowTodo,
  taskId: string,
  result: ExecutorRunResult,
  options: ApplyExecutorRunResultOptions = {},
): RunStatusUpdate {
  const currentTask = findTask(todo, taskId);
  const ok = result.exitCode === 0 && result.signal === null;
  const phase = ok
    ? (options.successStatus ?? "review")
    : failureStatusForTask(currentTask.status, options.failureStatus);
  const reason = ok ? undefined : buildFailureReason(result);
  const summary = buildRunStatusSummary({
    taskId,
    phase,
    ok,
    reason,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    updatedAt: options.now ?? result.endedAt,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    maxPreviewCharacters: options.maxPreviewCharacters,
    artifacts: result.artifactPaths,
  });
  const nextTodo = transitionTodoStatus(todo, taskId, phase);

  return {
    todo: annotateTaskWithRunSummary(nextTodo, summary),
    summary,
  };
}

export function buildRunStatusSummary(input: BuildRunStatusSummaryInput): RunStatusSummary {
  const stdout = redactSecrets(input.stdout ?? "");
  const stderr = redactSecrets(input.stderr ?? "");
  const maxPreviewCharacters = input.maxPreviewCharacters ?? DEFAULT_MAX_PREVIEW_CHARACTERS;

  return {
    taskId: input.taskId,
    phase: input.phase,
    ok: input.ok,
    reason: input.reason,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    durationMs: input.durationMs,
    exitCode: input.exitCode,
    signal: input.signal,
    stdoutBytes: stdout.length,
    stderrBytes: stderr.length,
    stdoutPreview: previewLog(stdout, maxPreviewCharacters),
    stderrPreview: previewLog(stderr, maxPreviewCharacters),
    artifacts: input.artifacts,
  };
}

export function markInterruptedRunsBlocked(
  todo: WorkflowTodo,
  interruptedRuns: readonly InterruptedRun[],
  options: { now?: string; maxPreviewCharacters?: number } = {},
): InterruptedRunRecovery {
  let nextTodo = cloneTodo(todo);
  const summaries: RunStatusSummary[] = [];

  for (const run of interruptedRuns) {
    const task = findTask(nextTodo, run.taskId);
    if (task.status !== "running") {
      continue;
    }

    const updatedAt = options.now ?? run.endedAt ?? new Date().toISOString();
    const summary = buildRunStatusSummary({
      taskId: run.taskId,
      phase: "blocked",
      ok: false,
      reason: run.reason,
      endedAt: run.endedAt,
      updatedAt,
      stdout: run.stdout,
      stderr: run.stderr,
      maxPreviewCharacters: options.maxPreviewCharacters,
    });
    nextTodo = annotateTaskWithRunSummary(
      transitionTodoStatus(nextTodo, run.taskId, "blocked"),
      summary,
    );
    summaries.push(summary);
  }

  return { todo: nextTodo, summaries };
}

export async function runExecutorProcess(
  input: ExecutorProcessInput,
): Promise<RunningExecutorProcess> {
  const artifactPaths = buildArtifactPaths(input.runDir);
  const startedAt = new Date();
  await mkdir(input.runDir, { recursive: true });

  if (input.handoffPrompt !== undefined) {
    await writeFile(artifactPaths.handoff, redactSecrets(input.handoffPrompt), "utf8");
  }

  const child = spawn(input.command, [...(input.args ?? [])], {
    cwd: input.cwd,
    env: input.env,
    stdio: "pipe",
  });

  const completed = collectProcessResult(child, {
    artifactPaths,
    startedAt,
    maxLogCharacters: input.maxLogCharacters ?? DEFAULT_MAX_LOG_CHARACTERS,
  });

  if (input.stdin !== undefined) {
    child.stdin.end(input.stdin);
  } else {
    child.stdin.end();
  }

  return {
    pid: child.pid,
    child,
    artifactPaths,
    startedAt: startedAt.toISOString(),
    completed,
  };
}

function buildArtifactPaths(runDir: string): ExecutorArtifactPaths {
  return {
    handoff: join(runDir, "handoff.md"),
    stdout: join(runDir, "stdout.log"),
    stderr: join(runDir, "stderr.log"),
    result: join(runDir, "result.json"),
  };
}

function findTask(todo: WorkflowTodo, taskId: string): TodoTask {
  const task = todo.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  return task;
}

function transitionTodoStatus(
  todo: WorkflowTodo,
  taskId: string,
  nextStatus: TaskStatus,
): WorkflowTodo {
  const task = findTask(todo, taskId);
  if (task.status === nextStatus) {
    return cloneTodo(todo);
  }

  const state = new StateManager("/unused");
  if (task.status === "running" && nextStatus === "done") {
    return state.transitionTask(state.transitionTask(todo, taskId, "review"), taskId, "done");
  }

  return state.transitionTask(todo, taskId, nextStatus);
}

function failureStatusForTask(
  currentStatus: TaskStatus,
  requestedStatus: ApplyExecutorRunResultOptions["failureStatus"],
): "blocked" | "fix_needed" {
  if (requestedStatus === "fix_needed" && currentStatus === "review") {
    return "fix_needed";
  }

  if (requestedStatus === "blocked") {
    return "blocked";
  }

  return currentStatus === "review" ? "fix_needed" : "blocked";
}

function buildFailureReason(result: ExecutorRunResult): string {
  if (result.signal) {
    return `process ended from signal ${result.signal}`;
  }

  if (result.exitCode !== 0) {
    return `process exited with exit code ${result.exitCode ?? "unknown"}`;
  }

  return "process did not complete successfully";
}

function previewLog(value: string, maxCharacters: number): string | undefined {
  if (value.length === 0 || maxCharacters <= 0) {
    return undefined;
  }

  const trimmedValue = value.replace(/\s+$/u, "");
  const preview =
    trimmedValue.length > maxCharacters
      ? trimmedValue.slice(trimmedValue.length - maxCharacters)
      : trimmedValue;
  return preview;
}

type TodoTaskWithRunSummary = TodoTask & {
  run_status?: RunStatusSummary;
  status_reason?: string;
  status_updated_at?: string;
};

function annotateTaskWithRunSummary(todo: WorkflowTodo, summary: RunStatusSummary): WorkflowTodo {
  return {
    ...todo,
    tasks: todo.tasks.map((task) => {
      if (task.id !== summary.taskId) {
        return { ...task };
      }

      const updatedTask: TodoTaskWithRunSummary = {
        ...task,
        run_status: summary,
        status_reason: summary.reason,
        status_updated_at: summary.updatedAt,
      };
      return updatedTask;
    }),
  };
}

function cloneTodo(todo: WorkflowTodo): WorkflowTodo {
  return {
    ...todo,
    tasks: todo.tasks.map((task) => ({ ...task })),
  };
}

function collectProcessResult(
  child: ChildProcessWithoutNullStreams,
  options: {
    artifactPaths: ExecutorArtifactPaths;
    startedAt: Date;
    maxLogCharacters: number;
  },
): Promise<ExecutorRunResult> {
  return new Promise((resolve, reject) => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let stdoutLength = 0;
    let stderrLength = 0;
    let processError: Error | undefined;

    child.stdout.on("data", (chunk: Buffer) => {
      const next = chunk.toString("utf8");
      stdoutLength = appendBoundedChunk(
        stdoutChunks,
        stdoutLength,
        next,
        options.maxLogCharacters,
      );
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const next = chunk.toString("utf8");
      stderrLength = appendBoundedChunk(
        stderrChunks,
        stderrLength,
        next,
        options.maxLogCharacters,
      );
    });

    child.on("error", (error) => {
      processError = error;
    });

    child.on("close", (exitCode, signal) => {
      void (async () => {
        const endedAt = new Date();
        const stdout = redactSecrets(stdoutChunks.join(""));
        const stderr = redactSecrets(
          processError
            ? [stderrChunks.join(""), processError.message].filter(Boolean).join("\n")
            : stderrChunks.join(""),
        );
        const result: ExecutorRunResult = {
          stdout,
          stderr,
          exitCode: processError ? null : exitCode,
          signal,
          startedAt: options.startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          durationMs: Math.max(0, endedAt.getTime() - options.startedAt.getTime()),
          artifactPaths: options.artifactPaths,
        };

        await writeFile(options.artifactPaths.stdout, stdout, "utf8");
        await writeFile(options.artifactPaths.stderr, stderr, "utf8");
        await writeFile(options.artifactPaths.result, `${JSON.stringify(result, null, 2)}\n`, "utf8");
        resolve(result);
      })().catch(reject);
    });
  });
}

function appendBoundedChunk(
  chunks: string[],
  currentLength: number,
  next: string,
  maxLength: number,
): number {
  chunks.push(next);
  let length = currentLength + next.length;

  while (length > maxLength && chunks.length > 0) {
    const first = chunks[0];
    if (!first) {
      chunks.shift();
      continue;
    }

    const excess = length - maxLength;
    if (first.length > excess) {
      chunks[0] = first.slice(excess);
      length = maxLength;
      break;
    }

    chunks.shift();
    length -= first.length;
  }

  return length;
}

function truncateText(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) {
    return value;
  }

  return value.slice(0, Math.max(0, maxCharacters));
}

function formatList(values: readonly string[]): string {
  if (values.length === 0) {
    return "- none";
  }

  return values.map((value) => `- ${value}`).join("\n");
}
