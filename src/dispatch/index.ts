import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  applyExecutorRunResultToTodo,
  buildExecutorHandoffPrompt,
  markTaskRunStarted,
  runExecutorProcess,
  type ExecutorArtifactPaths,
  type ExecutorRunResult,
  type RunStatusPhase,
} from "../execution/index.js";
import {
  appendRunHistoryEntry,
  createEmptyRunHistory,
} from "../history/index.js";
import {
  createEmptyTaskQueue,
  syncQueueFromTodo,
  updateQueueItemStatus,
} from "../queue/index.js";
import type { RunHistory, TaskQueue } from "../shared/types.js";
import { StateManager } from "../state/index.js";

export interface DispatchExecutorCommandInput {
  state: StateManager;
  taskId: string;
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  successStatus?: "review" | "done";
}

export interface DispatchExecutorCommandResult {
  taskId: string;
  ok: boolean;
  phase: RunStatusPhase;
  exitCode: number | null;
  runResult: ExecutorRunResult;
}

export async function dispatchExecutorCommand(
  input: DispatchExecutorCommandInput,
): Promise<DispatchExecutorCommandResult> {
  const todo = await input.state.loadTodo();
  const task = todo.tasks.find((candidate) => candidate.id === input.taskId);
  if (!task) {
    throw new Error(`Task not found: ${input.taskId}`);
  }

  const spec = await input.state.loadSpec().catch(() => "");
  const queue = syncQueueFromTodo(await loadTaskQueueOrEmpty(input.state), todo, {
    projectId: todo.project,
  });
  await input.state.saveTaskQueue(
    updateQueueItemStatus(queue, input.taskId, "running", {
      reason: "executor command started",
    }),
  );

  const started = markTaskRunStarted(todo, input.taskId);
  await input.state.saveTodo(started.todo);

  const runDir = join(input.state.rootDir, ".ai", "runs", input.taskId);
  const handoffPrompt = buildExecutorHandoffPrompt({ spec, task });
  const running = await runExecutorProcess({
    command: input.command,
    args: input.args,
    cwd: input.cwd ?? input.state.rootDir,
    env: input.env,
    runDir,
    handoffPrompt,
    stdin: handoffPrompt,
  });
  const runResult = await running.completed.catch((error: unknown) =>
    persistExecutorStartFailure(running.artifactPaths, running.startedAt, error),
  );
  const applied = applyExecutorRunResultToTodo(
    await input.state.loadTodo(),
    input.taskId,
    runResult,
    {
      successStatus: input.successStatus ?? "review",
      failureStatus: "blocked",
    },
  );
  await input.state.saveTodo(applied.todo);

  const nextQueue = updateQueueItemStatus(
    await loadTaskQueueOrEmpty(input.state),
    input.taskId,
    applied.summary.phase === "fix_needed" ? "blocked" : applied.summary.phase,
    { reason: applied.summary.reason },
  );
  await input.state.saveTaskQueue(nextQueue);

  const history = appendRunHistoryEntry(await loadRunHistoryOrEmpty(input.state), {
    kind: "run",
    task_id: input.taskId,
    project_id: todo.project,
    status: applied.summary.phase,
    started_at: runResult.startedAt,
    ended_at: runResult.endedAt,
    command: [input.command, ...(input.args ?? [])].join(" "),
    summary: applied.summary.reason ?? `Executor command completed with ${applied.summary.phase}.`,
    artifacts: [
      relativeRunArtifact(input.taskId, "handoff.md"),
      relativeRunArtifact(input.taskId, "stdout.log"),
      relativeRunArtifact(input.taskId, "stderr.log"),
      relativeRunArtifact(input.taskId, "result.json"),
    ],
  });
  await input.state.saveRunHistory(history);

  return {
    taskId: input.taskId,
    ok: runResult.exitCode === 0 && runResult.signal === null,
    phase: applied.summary.phase,
    exitCode: runResult.exitCode,
    runResult,
  };
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

function relativeRunArtifact(taskId: string, artifactName: string): string {
  return join(".ai", "runs", taskId, artifactName);
}

async function persistExecutorStartFailure(
  artifactPaths: ExecutorArtifactPaths,
  startedAt: string,
  error: unknown,
): Promise<ExecutorRunResult> {
  const endedAt = new Date();
  const stderr = error instanceof Error ? error.message : String(error);
  const result: ExecutorRunResult = {
    stdout: "",
    stderr,
    exitCode: null,
    signal: null,
    startedAt,
    endedAt: endedAt.toISOString(),
    durationMs: Math.max(0, endedAt.getTime() - new Date(startedAt).getTime()),
    artifactPaths,
  };

  await writeFile(artifactPaths.stdout, "", "utf8");
  await writeFile(artifactPaths.stderr, stderr, "utf8");
  await writeFile(artifactPaths.result, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
