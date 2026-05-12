import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import YAML from "yaml";

import { dispatchExecutorCommand, type DispatchExecutorCommandResult } from "../dispatch/index.js";
import { createEmptyTaskQueue, getNextQueueItems, syncQueueFromTodo } from "../queue/index.js";
import type { TaskQueue } from "../shared/types.js";
import { StateManager } from "../state/index.js";

export interface ExecutorProfile {
  command: string;
  args: string[];
  successStatus: "review" | "done";
  timeoutMs?: number;
}

export interface ExecutorProfilesConfig {
  version: number;
  default_profile?: string;
  profiles: Record<string, ExecutorProfile>;
}

export interface RunNextQueueItemInput {
  state: StateManager;
  command?: string;
  args?: readonly string[];
  profile?: string;
  profilePath?: string;
  successStatus?: "review" | "done";
  timeoutMs?: number;
  dryRun?: boolean;
}

export type RunNextQueueItemResult =
  | {
      status: "empty";
      taskId?: undefined;
      dispatch?: undefined;
      summary: string;
    }
  | {
      status: "dry-run";
      taskId: string;
      preview: ExecutorPreview;
      summary: string;
    }
  | {
      status: "executed";
      taskId: string;
      dispatch: DispatchExecutorCommandResult;
      summary: string;
    };

export interface ExecutorPreview {
  source: string;
  command: string;
  args: string[];
  successStatus: "review" | "done";
  timeoutMs?: number;
}

export interface ProfileValidationResult {
  ok: boolean;
  errors: string[];
  profiles: string[];
  defaultProfile?: string;
}

const EXECUTOR_PROFILES_PATH = join(".ai", "executor-profiles.yaml");

export async function runNextQueueItem(
  input: RunNextQueueItemInput,
): Promise<RunNextQueueItemResult> {
  const todo = await input.state.loadTodo();
  const queue = syncQueueFromTodo(await loadTaskQueueOrEmpty(input.state), todo, {
    projectId: todo.project,
  });
  if (!input.dryRun) {
    await input.state.saveTaskQueue(queue);
  }

  const [next] = getNextQueueItems(queue, 1);
  if (!next) {
    return {
      status: "empty",
      summary: "No pending queue items.",
    };
  }

  const executor = await resolveExecutor(input);
  if (input.dryRun) {
    return {
      status: "dry-run",
      taskId: next.task_id,
      preview: executor,
      summary: `Would execute ${next.task_id} with ${executor.source}.`,
    };
  }

  const dispatch = await dispatchExecutorCommand({
    state: input.state,
    taskId: next.task_id,
    command: executor.command,
    args: executor.args,
    successStatus: executor.successStatus,
    timeoutMs: executor.timeoutMs,
  });

  return {
    status: "executed",
    taskId: next.task_id,
    dispatch,
    summary: `Executed ${next.task_id} with ${executor.source}.`,
  };
}

export async function loadExecutorProfiles(
  state: StateManager,
  profilePath = EXECUTOR_PROFILES_PATH,
): Promise<ExecutorProfilesConfig> {
  const source = await readFile(resolveProfilePath(state, profilePath), "utf8");
  const parsed = YAML.parse(source) as unknown;
  return normalizeExecutorProfiles(parsed);
}

export async function validateExecutorProfiles(
  state: StateManager,
  profilePath = EXECUTOR_PROFILES_PATH,
): Promise<ProfileValidationResult> {
  try {
    const source = await readFile(resolveProfilePath(state, profilePath), "utf8");
    const parsed = YAML.parse(source) as unknown;
    return validateExecutorProfilesValue(parsed);
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
      profiles: [],
    };
  }
}

function resolveProfilePath(state: StateManager, profilePath: string): string {
  return isAbsolute(profilePath) ? profilePath : join(state.rootDir, profilePath);
}

async function resolveExecutor(input: RunNextQueueItemInput): Promise<
  ExecutorProfile & {
    source: string;
  }
> {
  if (input.command) {
    return {
      command: input.command,
      args: [...(input.args ?? [])],
      successStatus: input.successStatus ?? "review",
      ...(normalizeTimeoutMs(input.timeoutMs) ? { timeoutMs: normalizeTimeoutMs(input.timeoutMs) } : {}),
      source: "command options",
    };
  }

  const config = await loadExecutorProfiles(input.state, input.profilePath).catch((error) => {
    if (isMissingFile(error)) {
      throw new Error(
        "run-next requires --executor-command or .ai/executor-profiles.yaml",
      );
    }
    throw error;
  });
  const profileName = input.profile ?? config.default_profile;
  if (!profileName) {
    throw new Error("run-next requires --profile or default_profile in executor profiles.");
  }

  const profile = config.profiles[profileName];
  if (!profile) {
    throw new Error(`Executor profile not found: ${profileName}`);
  }

  return {
    ...profile,
    ...(normalizeTimeoutMs(input.timeoutMs) ? { timeoutMs: normalizeTimeoutMs(input.timeoutMs) } : {}),
    source: `profile ${profileName}`,
  };
}

function normalizeExecutorProfiles(value: unknown): ExecutorProfilesConfig {
  if (!isRecord(value)) {
    throw new Error("Executor profiles config must be a YAML object.");
  }
  if (!isRecord(value.profiles)) {
    throw new Error("Executor profiles config must define profiles.");
  }

  const profiles: Record<string, ExecutorProfile> = {};
  for (const [name, rawProfile] of Object.entries(value.profiles)) {
    profiles[name] = normalizeExecutorProfile(name, rawProfile);
  }

  return {
    version: numberValue(value.version, "version"),
    ...(typeof value.default_profile === "string"
      ? { default_profile: value.default_profile }
      : {}),
    profiles,
  };
}

function normalizeExecutorProfile(name: string, value: unknown): ExecutorProfile {
  if (!isRecord(value)) {
    throw new Error(`Executor profile ${name} must be an object.`);
  }

  const successStatus = value.success_status ?? value.successStatus ?? "review";
  if (successStatus !== "review" && successStatus !== "done") {
    throw new Error(`Executor profile ${name} success_status must be review or done.`);
  }
  const timeoutMs = value.timeout_ms ?? value.timeoutMs;

  return {
    command: stringValue(value.command, `profiles.${name}.command`),
    args: stringArrayValue(value.args ?? [], `profiles.${name}.args`),
    successStatus,
    ...(timeoutMs === undefined || timeoutMs === null
      ? {}
      : { timeoutMs: positiveIntegerValue(timeoutMs, `profiles.${name}.timeout_ms`) }),
  };
}

function validateExecutorProfilesValue(value: unknown): ProfileValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return {
      ok: false,
      errors: ["Executor profiles config must be a YAML object."],
      profiles: [],
    };
  }

  if (!isRecord(value.profiles)) {
    errors.push("Executor profiles config must define profiles.");
  }

  const profileNames = isRecord(value.profiles) ? Object.keys(value.profiles) : [];
  for (const name of profileNames) {
    errors.push(
      ...validateExecutorProfileFields(name, (value.profiles as Record<string, unknown>)[name]),
    );
  }

  if (
    typeof value.default_profile === "string" &&
    isRecord(value.profiles) &&
    !(value.default_profile in value.profiles)
  ) {
    errors.push(`default_profile ${value.default_profile} does not match a configured profile.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    profiles: profileNames,
    ...(typeof value.default_profile === "string"
      ? { defaultProfile: value.default_profile }
      : {}),
  };
}

function validateExecutorProfileFields(name: string, value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return [`Executor profile ${name} must be an object.`];
  }

  if (typeof value.command !== "string" || value.command.trim().length === 0) {
    errors.push(`Executor profile profiles.${name}.command must be a non-empty string.`);
  }

  if (
    value.args !== undefined &&
    (!Array.isArray(value.args) || !value.args.every((item) => typeof item === "string"))
  ) {
    errors.push(`Executor profile profiles.${name}.args must be a string array.`);
  }

  const successStatus = value.success_status ?? value.successStatus ?? "review";
  if (successStatus !== "review" && successStatus !== "done") {
    errors.push(`Executor profile ${name} success_status must be review or done.`);
  }

  const timeoutMs = value.timeout_ms ?? value.timeoutMs;
  if (
    timeoutMs !== undefined &&
    timeoutMs !== null &&
    (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 0)
  ) {
    errors.push(`Executor profile profiles.${name}.timeout_ms must be a non-negative integer.`);
  }

  return errors;
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

function numberValue(value: unknown, field: string): number {
  if (typeof value !== "number") {
    throw new Error(`Executor profiles ${field} must be a number.`);
  }
  return value;
}

function positiveIntegerValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Executor profile ${field} must be a non-negative integer.`);
  }
  return value;
}

function normalizeTimeoutMs(value: number | undefined): number | undefined {
  if (value === undefined || value <= 0) {
    return undefined;
  }
  return value;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Executor profile ${field} must be a non-empty string.`);
  }
  return value;
}

function stringArrayValue(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Executor profile ${field} must be a string array.`);
  }
  return [...value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
