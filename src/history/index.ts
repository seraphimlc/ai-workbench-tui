import type { RunHistory, RunHistoryEntry } from "../shared/types.js";

const HISTORY_VERSION = 1;

export function createEmptyRunHistory(): RunHistory {
  return {
    version: HISTORY_VERSION,
    entries: [],
  };
}

export function appendRunHistoryEntry(
  history: RunHistory | undefined,
  entry: Omit<RunHistoryEntry, "id" | "started_at"> & {
    id?: string;
    started_at?: string;
  },
): RunHistory {
  const current = history ?? createEmptyRunHistory();
  const startedAt = entry.started_at ?? new Date().toISOString();
  const nextEntry: RunHistoryEntry = {
    id: entry.id ?? buildHistoryId(entry.kind, entry.task_id, startedAt),
    task_id: entry.task_id,
    project_id: entry.project_id,
    kind: entry.kind,
    status: entry.status,
    started_at: startedAt,
    ended_at: entry.ended_at,
    command: entry.command,
    summary: entry.summary,
    artifacts: entry.artifacts,
  };

  return {
    version: HISTORY_VERSION,
    entries: [nextEntry, ...current.entries].sort((left, right) =>
      right.started_at.localeCompare(left.started_at),
    ),
  };
}

export function listRunHistory(
  history: RunHistory,
  options: { limit?: number; taskId?: string } = {},
): RunHistoryEntry[] {
  const limit = options.limit ?? 10;
  return history.entries
    .filter((entry) => !options.taskId || entry.task_id === options.taskId)
    .sort((left, right) => right.started_at.localeCompare(left.started_at))
    .slice(0, limit)
    .map((entry) => ({ ...entry, artifacts: entry.artifacts ? [...entry.artifacts] : undefined }));
}

export function renderRunHistory(
  history: RunHistory,
  options: { limit?: number; taskId?: string } = {},
): string {
  const entries = listRunHistory(history, options);
  if (entries.length === 0) {
    return "History:\n- empty";
  }

  return [
    "History:",
    ...entries.map(
      (entry) =>
        `- ${entry.started_at} ${entry.kind} ${entry.task_id ?? "-"} ${entry.status}: ${
          entry.summary
        }`,
    ),
  ].join("\n");
}

function buildHistoryId(kind: string, taskId: string | undefined, startedAt: string): string {
  const normalizedTask = taskId ?? "workspace";
  return `${kind}-${normalizedTask}-${startedAt.replace(/[^0-9A-Za-z]/gu, "")}`;
}
