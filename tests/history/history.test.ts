import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendRunHistoryEntry,
  createEmptyRunHistory,
  listRunHistory,
  renderRunHistory,
} from "../../src/history/index.js";

test("appendRunHistoryEntry prepends and sorts recent entries", () => {
  const history = appendRunHistoryEntry(
    appendRunHistoryEntry(createEmptyRunHistory(), {
      kind: "run",
      task_id: "T-1",
      status: "prepared",
      started_at: "2026-05-12T00:00:00.000Z",
      summary: "Prepared run.",
    }),
    {
      kind: "review",
      task_id: "T-1",
      status: "prepared",
      started_at: "2026-05-12T01:00:00.000Z",
      summary: "Prepared review.",
    },
  );

  assert.deepEqual(
    listRunHistory(history).map((entry) => entry.kind),
    ["review", "run"],
  );
  assert.match(renderRunHistory(history), /review T-1 prepared/);
});

test("listRunHistory can filter by task id and limit results", () => {
  const history = [
    ["T-1", "2026-05-12T00:00:00.000Z"],
    ["T-2", "2026-05-12T01:00:00.000Z"],
    ["T-1", "2026-05-12T02:00:00.000Z"],
  ].reduce(
    (current, [taskId, startedAt]) =>
      appendRunHistoryEntry(current, {
        kind: "run",
        task_id: taskId,
        status: "prepared",
        started_at: startedAt,
        summary: `Prepared ${taskId}.`,
      }),
    createEmptyRunHistory(),
  );

  assert.deepEqual(
    listRunHistory(history, { taskId: "T-1", limit: 1 }).map((entry) => entry.started_at),
    ["2026-05-12T02:00:00.000Z"],
  );
});
