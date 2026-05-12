import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildExecutorHandoffPrompt,
  redactSecrets,
  runExecutorProcess,
} from "../../src/execution/index.js";
import type { TodoTask } from "../../src/shared/types.js";

const task: TodoTask = {
  id: "T-008",
  title: "Implement executor dispatch protocol",
  type: "coding",
  status: "running",
  agent: "executor",
  dependencies: ["T-005", "T-006"],
  write_scope: ["src/execution/**", "tests/execution/**"],
  acceptance: [
    "Can build a bounded handoff prompt from spec, todo item, scope, and acceptance criteria.",
    "Can start a background CLI process for an executor.",
  ],
  output: ["changed_files", "test_results"],
};

async function withTempDir<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "execution-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("buildExecutorHandoffPrompt creates bounded task context", () => {
  const prompt = buildExecutorHandoffPrompt({
    spec: `# Spec\n${"Keep this bounded.\n".repeat(20)}`,
    task,
    maxSpecCharacters: 80,
  });

  assert.match(prompt, /Executor handoff for T-008/);
  assert.match(prompt, /Implement executor dispatch protocol/);
  assert.match(prompt, /src\/execution\/\*\*/);
  assert.match(prompt, /tests\/execution\/\*\*/);
  assert.match(prompt, /Can start a background CLI process/);
  assert.match(prompt, /Spec excerpt truncated/);
  assert.doesNotMatch(prompt, /src\/review/);
});

test("redactSecrets removes environment-like secret values", () => {
  const redacted = redactSecrets(
    "API_KEY=sk-live-abc123 TOKEN='tok-secret' password: hunter2 normal=value",
  );

  assert.equal(redacted.includes("sk-live-abc123"), false);
  assert.equal(redacted.includes("tok-secret"), false);
  assert.equal(redacted.includes("hunter2"), false);
  assert.match(redacted, /API_KEY=\[REDACTED\]/);
  assert.match(redacted, /TOKEN=\[REDACTED\]/);
  assert.match(redacted, /password: \[REDACTED\]/i);
  assert.match(redacted, /normal=value/);
});

test("runExecutorProcess starts a background process and captures redacted artifacts", async () => {
  await withTempDir(async (root) => {
    const run = await runExecutorProcess({
      command: process.execPath,
      args: [
        "-e",
        "console.log('ready stdout API_KEY=plain-secret'); console.error('bad stderr TOKEN=hidden-token'); process.exit(7);",
      ],
      cwd: root,
      runDir: join(root, ".ai", "runs", "T-008"),
      handoffPrompt: "handoff body SECRET=do-not-log",
    });

    assert.equal(typeof run.pid, "number");

    const result = await run.completed;

    assert.equal(result.exitCode, 7);
    assert.equal(result.signal, null);
    assert.match(result.stdout, /ready stdout API_KEY=\[REDACTED\]/);
    assert.match(result.stderr, /bad stderr TOKEN=\[REDACTED\]/);
    assert.equal(result.stdout.includes("plain-secret"), false);
    assert.equal(result.stderr.includes("hidden-token"), false);
    assert.ok(Date.parse(result.startedAt) <= Date.parse(result.endedAt));
    assert.ok(result.durationMs >= 0);

    assert.ok(result.artifactPaths.handoff.endsWith("handoff.md"));
    assert.ok(result.artifactPaths.stdout.endsWith("stdout.log"));
    assert.ok(result.artifactPaths.stderr.endsWith("stderr.log"));

    assert.match(await readFile(result.artifactPaths.stdout, "utf8"), /API_KEY=\[REDACTED\]/);
    assert.match(await readFile(result.artifactPaths.stderr, "utf8"), /TOKEN=\[REDACTED\]/);
    assert.match(await readFile(result.artifactPaths.handoff, "utf8"), /SECRET=\[REDACTED\]/);
  });
});
